//! Per-space SQLite link index under `<space>/.hip/index.sqlite`.
//! Parse happens in TS; this module only persists and queries.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::knowledge::is_knowledge_id;
use crate::paths;
use crate::skills::safe_join;

const SCHEMA_VERSION: i32 = 1;

fn knowledge_root(app: &AppHandle) -> Result<PathBuf, String> {
    paths::knowledge_dir(app).ok_or_else(|| "knowledge root unavailable".to_string())
}

fn require_id(id: &str, label: &str) -> Result<(), String> {
    if is_knowledge_id(id) {
        Ok(())
    } else {
        Err(format!("invalid {label}: {id}"))
    }
}

fn space_dir(root: &Path, space_id: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    safe_join(root, space_id).ok_or_else(|| "illegal space path".to_string())
}

fn hip_dir(root: &Path, space_id: &str) -> Result<PathBuf, String> {
    let space = space_dir(root, space_id)?;
    let hip = safe_join(&space, ".hip").ok_or_else(|| "illegal .hip path".to_string())?;
    Ok(hip)
}

fn db_path(root: &Path, space_id: &str) -> Result<PathBuf, String> {
    let hip = hip_dir(root, space_id)?;
    safe_join(&hip, "index.sqlite").ok_or_else(|| "illegal index path".to_string())
}

fn open_db(root: &Path, space_id: &str) -> Result<Connection, String> {
    let hip = hip_dir(root, space_id)?;
    fs::create_dir_all(&hip).map_err(|e| format!("create .hip: {e}"))?;
    let path = db_path(root, space_id)?;
    let conn = Connection::open(&path).map_err(|e| format!("open index.sqlite: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;",
    )
    .map_err(|e| format!("pragma: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS docs (
            doc_id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            aliases_json TEXT NOT NULL DEFAULT '[]',
            tags_json TEXT NOT NULL DEFAULT '[]',
            status TEXT,
            props_json TEXT NOT NULL DEFAULT '{}',
            content_hash TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_doc_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            raw TEXT NOT NULL,
            target_title TEXT,
            target_doc_id TEXT,
            fragment TEXT,
            display TEXT,
            FOREIGN KEY (from_doc_id) REFERENCES docs(doc_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_doc_id);
        CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_doc_id);",
    )
    .map_err(|e| format!("migrate schema: {e}"))?;

    let ver: i32 = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |r| {
                let s: String = r.get(0)?;
                Ok(s.parse::<i32>().unwrap_or(0))
            },
        )
        .unwrap_or(0);

    if ver < SCHEMA_VERSION {
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|e| format!("set schema_version: {e}"))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOutboundIn {
    pub kind: String,
    pub raw: String,
    pub target_title: Option<String>,
    pub target_doc_id: Option<String>,
    pub fragment: Option<String>,
    pub display: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDocPayload {
    pub doc_id: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub status: Option<String>,
    pub props: serde_json::Value,
    pub content_hash: String,
    pub updated_at: i64,
    pub outbound: Vec<LinkOutboundIn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkBacklink {
    pub from_doc_id: String,
    pub from_title: String,
    pub raw: String,
    pub kind: String,
    pub fragment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOutboundRow {
    pub kind: String,
    pub raw: String,
    pub target_title: Option<String>,
    pub target_doc_id: Option<String>,
    pub fragment: Option<String>,
    pub display: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkBrokenRow {
    pub from_doc_id: String,
    pub from_title: String,
    pub raw: String,
    pub kind: String,
}

fn upsert_doc_tx(conn: &Connection, doc: &LinkDocPayload) -> Result<(), String> {
    require_id(&doc.doc_id, "docId")?;
    let aliases = serde_json::to_string(&doc.aliases).map_err(|e| e.to_string())?;
    let tags = serde_json::to_string(&doc.tags).map_err(|e| e.to_string())?;
    let props = serde_json::to_string(&doc.props).unwrap_or_else(|_| "{}".into());

    conn.execute(
        "INSERT INTO docs(doc_id, title, aliases_json, tags_json, status, props_json, content_hash, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(doc_id) DO UPDATE SET
           title=excluded.title,
           aliases_json=excluded.aliases_json,
           tags_json=excluded.tags_json,
           status=excluded.status,
           props_json=excluded.props_json,
           content_hash=excluded.content_hash,
           updated_at=excluded.updated_at",
        params![
            doc.doc_id,
            doc.title,
            aliases,
            tags,
            doc.status,
            props,
            doc.content_hash,
            doc.updated_at,
        ],
    )
    .map_err(|e| format!("upsert doc: {e}"))?;

    conn.execute("DELETE FROM links WHERE from_doc_id = ?1", params![doc.doc_id])
        .map_err(|e| format!("clear links: {e}"))?;

    for link in &doc.outbound {
        if let Some(ref tid) = link.target_doc_id {
            if !tid.is_empty() {
                require_id(tid, "targetDocId")?;
            }
        }
        conn.execute(
            "INSERT INTO links(from_doc_id, kind, raw, target_title, target_doc_id, fragment, display)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                doc.doc_id,
                link.kind,
                link.raw,
                link.target_title,
                link.target_doc_id,
                link.fragment,
                link.display,
            ],
        )
        .map_err(|e| format!("insert link: {e}"))?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceDocArgs {
    pub space_id: String,
    pub doc_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertArgs {
    pub space_id: String,
    pub doc: LinkDocPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceAllArgs {
    pub space_id: String,
    pub docs: Vec<LinkDocPayload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceOnlyArgs {
    pub space_id: String,
}

#[tauri::command]
pub fn knowledge_link_index_upsert(app: AppHandle, args: UpsertArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let conn = open_db(&root, &args.space_id)?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("tx: {e}"))?;
    upsert_doc_tx(&tx, &args.doc)?;
    tx.commit().map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn knowledge_link_index_remove_doc(app: AppHandle, args: SpaceDocArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    require_id(&args.doc_id, "docId")?;
    let conn = open_db(&root, &args.space_id)?;
    conn.execute("DELETE FROM docs WHERE doc_id = ?1", params![args.doc_id])
        .map_err(|e| format!("remove doc: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn knowledge_link_index_replace_all(app: AppHandle, args: ReplaceAllArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let conn = open_db(&root, &args.space_id)?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("tx: {e}"))?;
    tx.execute("DELETE FROM links", [])
        .map_err(|e| format!("clear links: {e}"))?;
    tx.execute("DELETE FROM docs", [])
        .map_err(|e| format!("clear docs: {e}"))?;
    for doc in &args.docs {
        upsert_doc_tx(&tx, doc)?;
    }
    tx.commit().map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn knowledge_link_index_backlinks(
    app: AppHandle,
    args: SpaceDocArgs,
) -> Result<Vec<LinkBacklink>, String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    require_id(&args.doc_id, "docId")?;
    let path = db_path(&root, &args.space_id)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let conn = open_db(&root, &args.space_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT l.from_doc_id, d.title, l.raw, l.kind, l.fragment
             FROM links l
             JOIN docs d ON d.doc_id = l.from_doc_id
             WHERE l.target_doc_id = ?1
               AND l.kind IN ('wiki', 'embed')
             ORDER BY d.title COLLATE NOCASE, l.id",
        )
        .map_err(|e| format!("prepare backlinks: {e}"))?;
    let rows = stmt
        .query_map(params![args.doc_id], |r| {
            Ok(LinkBacklink {
                from_doc_id: r.get(0)?,
                from_title: r.get(1)?,
                raw: r.get(2)?,
                kind: r.get(3)?,
                fragment: r.get(4)?,
            })
        })
        .map_err(|e| format!("query backlinks: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn knowledge_link_index_outbound(
    app: AppHandle,
    args: SpaceDocArgs,
) -> Result<Vec<LinkOutboundRow>, String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    require_id(&args.doc_id, "docId")?;
    let path = db_path(&root, &args.space_id)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let conn = open_db(&root, &args.space_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT kind, raw, target_title, target_doc_id, fragment, display
             FROM links WHERE from_doc_id = ?1 ORDER BY id",
        )
        .map_err(|e| format!("prepare outbound: {e}"))?;
    let rows = stmt
        .query_map(params![args.doc_id], |r| {
            Ok(LinkOutboundRow {
                kind: r.get(0)?,
                raw: r.get(1)?,
                target_title: r.get(2)?,
                target_doc_id: r.get(3)?,
                fragment: r.get(4)?,
                display: r.get(5)?,
            })
        })
        .map_err(|e| format!("query outbound: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn knowledge_link_index_broken(
    app: AppHandle,
    args: SpaceOnlyArgs,
) -> Result<Vec<LinkBrokenRow>, String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let path = db_path(&root, &args.space_id)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let conn = open_db(&root, &args.space_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT l.from_doc_id, d.title, l.raw, l.kind
             FROM links l
             JOIN docs d ON d.doc_id = l.from_doc_id
             WHERE l.kind IN ('wiki', 'embed')
               AND (l.target_doc_id IS NULL OR l.target_doc_id = '')
               AND NOT (l.target_title IS NOT NULL AND l.target_title = '' AND l.fragment IS NOT NULL)
             ORDER BY d.title COLLATE NOCASE, l.id",
        )
        .map_err(|e| format!("prepare broken: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LinkBrokenRow {
                from_doc_id: r.get(0)?,
                from_title: r.get(1)?,
                raw: r.get(2)?,
                kind: r.get(3)?,
            })
        })
        .map_err(|e| format!("query broken: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeRow {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeRow {
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPayload {
    pub nodes: Vec<GraphNodeRow>,
    pub edges: Vec<GraphEdgeRow>,
}

/// Full space graph: docs as nodes, wiki/embed resolved edges.
#[tauri::command]
pub fn knowledge_link_index_graph(app: AppHandle, args: SpaceOnlyArgs) -> Result<GraphPayload, String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let path = db_path(&root, &args.space_id)?;
    if !path.exists() {
        return Ok(GraphPayload {
            nodes: vec![],
            edges: vec![],
        });
    }
    let conn = open_db(&root, &args.space_id)?;
    let mut node_stmt = conn
        .prepare("SELECT doc_id, title FROM docs ORDER BY title COLLATE NOCASE")
        .map_err(|e| format!("prepare graph nodes: {e}"))?;
    let node_rows = node_stmt
        .query_map([], |r| {
            Ok(GraphNodeRow {
                id: r.get(0)?,
                title: r.get(1)?,
            })
        })
        .map_err(|e| format!("query graph nodes: {e}"))?;
    let mut nodes = Vec::new();
    for row in node_rows {
        nodes.push(row.map_err(|e| format!("node row: {e}"))?);
    }

    let mut edge_stmt = conn
        .prepare(
            "SELECT from_doc_id, target_doc_id, kind FROM links
             WHERE target_doc_id IS NOT NULL AND target_doc_id != ''
               AND kind IN ('wiki', 'embed')
             ORDER BY id",
        )
        .map_err(|e| format!("prepare graph edges: {e}"))?;
    let edge_rows = edge_stmt
        .query_map([], |r| {
            Ok(GraphEdgeRow {
                from: r.get(0)?,
                to: r.get(1)?,
                kind: r.get(2)?,
            })
        })
        .map_err(|e| format!("query graph edges: {e}"))?;
    let mut edges = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();
    for row in edge_rows {
        let e = row.map_err(|e| format!("edge row: {e}"))?;
        let key = format!("{}→{}:{}", e.from, e.to, e.kind);
        if seen.insert(key) {
            edges.push(e);
        }
    }
    Ok(GraphPayload { nodes, edges })
}

/// Doc count in index (0 if missing). Used to decide rebuild on open.
#[tauri::command]
pub fn knowledge_link_index_doc_count(app: AppHandle, args: SpaceOnlyArgs) -> Result<u32, String> {
    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let path = db_path(&root, &args.space_id)?;
    if !path.exists() {
        return Ok(0);
    }
    let conn = open_db(&root, &args.space_id)?;
    let n: u32 = conn
        .query_row("SELECT COUNT(*) FROM docs", [], |r| r.get(0))
        .map_err(|e| format!("count: {e}"))?;
    Ok(n)
}

// Re-export path helper for knowledge.rs zip export exclusion if needed later.
#[allow(dead_code)]
pub fn link_index_db_path(app: &AppHandle, space_id: &str) -> Result<PathBuf, String> {
    let root = knowledge_root(app)?;
    db_path(&root, space_id)
}
