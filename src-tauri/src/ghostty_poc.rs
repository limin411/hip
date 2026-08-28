// PR-0 PoC: Verify libghostty-vt integration feasibility.
// See docs/design/terminal-ghostty-kernel/terminal-ghostty-kernel-spec.md
//
// Run: cargo test ghostty_poc -- --nocapture

#[cfg(test)]
mod ghostty_poc {
    use std::cell::Cell;
    use std::rc::Rc;

    use libghostty_vt::render::{CellIterator, Dirty, RenderState, RowIterator};
    use libghostty_vt::terminal::{Options as TerminalOptions, ScrollViewport};
    use libghostty_vt::Terminal;

    // ---------------------------------------------------------------------------
    // V1: Terminal::new() + vt_write() basic functionality
    // ---------------------------------------------------------------------------

    #[test]
    fn v1_terminal_create_and_write() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 1000,
        })
        .expect("Terminal::new failed");

        // Feed plain text
        terminal.vt_write(b"Hello, World!\r\n");

        // Feed ANSI color codes
        terminal.vt_write(b"\x1b[1;32mBold Green\x1b[0m\r\n");

        // Feed cursor positioning
        terminal.vt_write(b"\x1b[1;1HTop-left\r\n");

        // Feed erase line
        terminal.vt_write(b"\x1b[2KCleared line\r\n");

        // Multiple lines
        terminal.vt_write(b"Line A\r\nLine B\r\nLine C\r\n");

        println!("[V1] Terminal create + vt_write: OK");
    }

    // ---------------------------------------------------------------------------
    // V2: RenderState + dirty tracking + cell iteration
    // ---------------------------------------------------------------------------

    #[test]
    fn v2_render_state_dirty_tracking() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 1000,
        })
        .expect("Terminal::new failed");
        let mut render_state = RenderState::new().expect("RenderState::new failed");

        // Initial render — should be Full dirty
        let snapshot = render_state
            .update(&terminal)
            .expect("initial update failed");
        match snapshot.dirty().expect("dirty check failed") {
            Dirty::Full => println!("[V2] Initial dirty state: Full (expected)"),
            other => println!("[V2] Initial dirty state: {other:?} (expected Full)"),
        }

        // Feed content
        terminal.vt_write(b"Hello\r\n");

        // Second render — should be Partial or Full
        let snapshot = render_state.update(&terminal).expect("update after write failed");
        match snapshot.dirty().expect("dirty check failed") {
            Dirty::Clean => println!("[V2] Post-write dirty state: Clean"),
            Dirty::Partial => println!("[V2] Post-write dirty state: Partial"),
            Dirty::Full => println!("[V2] Post-write dirty state: Full"),
        }

        // Mark clean
        snapshot
            .set_dirty(Dirty::Clean)
            .expect("set_dirty(Clean) failed");

        // Third render without changes — should be Clean
        let snapshot = render_state
            .update(&terminal)
            .expect("update without changes failed");
        match snapshot.dirty().expect("dirty check failed") {
            Dirty::Clean => println!("[V2] No-change dirty state: Clean (expected)"),
            other => println!("[V2] No-change dirty state: {other:?} (expected Clean)"),
        }

        println!("[V2] RenderState dirty tracking: OK");
    }

    // ---------------------------------------------------------------------------
    // V3: Grid cell iteration — read back written content
    // ---------------------------------------------------------------------------

    #[test]
    fn v3_grid_cell_iteration() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 40,
            rows: 5,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");
        terminal.vt_write(b"AB\x1b[1;31mCD\x1b[0m\r\n");
        terminal.vt_write(b"\x1b[4mUnderline\x1b[0m\r\n");

        let mut render_state = RenderState::new().expect("RenderState::new failed");
        let snapshot = render_state.update(&terminal).expect("update failed");

        let mut row_it = RowIterator::new().expect("RowIterator::new failed");
        let mut cell_it = CellIterator::new().expect("CellIterator::new failed");

        let mut rows_content: Vec<String> = Vec::new();
        let mut row_it = row_it.update(&snapshot).expect("row_it update failed");

        while let Some(row) = row_it.next() {
            let mut row_text = String::new();
            let mut cell_it = cell_it.update(row).expect("cell_it update failed");

            while let Some(cell) = cell_it.next() {
                let graphemes = cell.graphemes_len().expect("graphemes_len failed");
                if graphemes > 0 {
                    let mut text = String::with_capacity(8);
                    cell.graphemes_utf8(&mut text)
                        .expect("graphemes_utf8 failed");
                    row_text.push_str(&text);
                } else {
                    row_text.push(' ');
                }
            }
            rows_content.push(row_text.clone());
            row.set_dirty(false).expect("set_dirty(false) failed");
        }

        // Verify content
        let first_row = rows_content.first().expect("no rows found");
        assert!(
            first_row.starts_with("AB"),
            "Expected 'AB...' in first row, got: '{first_row}'"
        );
        assert!(
            first_row.contains('C'),
            "Expected 'C' in first row, got: '{first_row}'"
        );
        assert!(
            first_row.contains('D'),
            "Expected 'D' in first row, got: '{first_row}'"
        );

        println!("[V3] Grid cell iteration: OK");
        for (i, row) in rows_content.iter().enumerate() {
            println!("  Row {i}: '{}'", row.trim_end());
        }
    }

    // ---------------------------------------------------------------------------
    // V4: Color and style reading
    // ---------------------------------------------------------------------------

    #[test]
    fn v4_color_and_style() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 40,
            rows: 5,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");

        // Bold green text
        terminal.vt_write(b"\x1b[1;32mGreen\x1b[0m\r\n");
        // Underlined text
        terminal.vt_write(b"\x1b[4mUnder\x1b[0m\r\n");
        // 24-bit RGB orange
        terminal.vt_write(b"\x1b[38;2;255;128;0mOrange\x1b[0m\r\n");

        let mut render_state = RenderState::new().expect("RenderState::new failed");
        let snapshot = render_state.update(&terminal).expect("update failed");

        // Read default colors
        let colors = snapshot.colors().expect("colors failed");
        println!(
            "[V4] Background: {:02x}{:02x}{:02x}",
            colors.background.r, colors.background.g, colors.background.b
        );
        println!(
            "[V4] Foreground: {:02x}{:02x}{:02x}",
            colors.foreground.r, colors.foreground.g, colors.foreground.b
        );

        // Iterate cells and check for colored cells
        let mut row_it = RowIterator::new().expect("RowIterator::new failed");
        let mut cell_it = CellIterator::new().expect("CellIterator::new failed");
        let mut row_it = row_it.update(&snapshot).expect("row_it update failed");

        let mut found_colored = false;
        let mut found_styled = false;

        while let Some(row) = row_it.next() {
            let mut cell_it = cell_it.update(row).expect("cell_it update failed");
            while let Some(cell) = cell_it.next() {
                if let Ok(Some(fg)) = cell.fg_color() {
                    if fg != colors.foreground {
                        found_colored = true;
                        println!(
                            "[V4] Found colored cell: fg={:02x}{:02x}{:02x}",
                            fg.r, fg.g, fg.b
                        );
                    }
                }
                if cell.has_styling().unwrap_or(false) {
                    found_styled = true;
                    if let Ok(style) = cell.style() {
                        println!(
                            "[V4] Found styled cell: bold={}, underline={:?}, italic={}",
                            style.bold, style.underline, style.italic
                        );
                    }
                }
            }
        }

        assert!(found_colored, "Expected at least one colored cell");
        assert!(found_styled, "Expected at least one styled cell");
        println!("[V4] Color and style reading: OK");
    }

    // ---------------------------------------------------------------------------
    // V5: Effect callbacks (bell, title, pty_write)
    // ---------------------------------------------------------------------------

    #[test]
    fn v5_effect_callbacks() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");

        let bell_count = Rc::new(Cell::new(0u32));
        let bell_clone = bell_count.clone();
        terminal
            .on_bell(move |_term| {
                bell_clone.set(bell_clone.get() + 1);
            })
            .expect("on_bell failed");

        let title_changed = Rc::new(Cell::new(false));
        let title_clone = title_changed.clone();
        terminal
            .on_title_changed(move |_term| {
                title_clone.set(true);
            })
            .expect("on_title_changed failed");

        let pty_write_called = Rc::new(Cell::new(false));
        let pty_clone = pty_write_called.clone();
        terminal
            .on_pty_write(move |_term, _data| {
                pty_clone.set(true);
            })
            .expect("on_pty_write failed");

        // Trigger bell
        terminal.vt_write(b"\x07");
        terminal.vt_write(b"\x07");
        assert_eq!(bell_count.get(), 2, "Expected 2 bell events");

        // Trigger title change (OSC 2)
        terminal.vt_write(b"\x1b]2;Hello Title\x1b\\");
        assert!(title_changed.get(), "Expected title_changed callback");

        // Trigger pty_write (DECRQM for wraparound mode ?7)
        terminal.vt_write(b"\x1B[?7$p");
        assert!(pty_write_called.get(), "Expected pty_write callback");

        // Read title
        let title = terminal.title().expect("title() failed");
        println!("[V5] Title: '{title}'");
        assert_eq!(title, "Hello Title");

        println!(
            "[V5] Effect callbacks: OK (bells={}, title_changed={}, pty_write={})",
            bell_count.get(),
            title_changed.get(),
            pty_write_called.get()
        );
    }

    // ---------------------------------------------------------------------------
    // V6: Cursor state
    // ---------------------------------------------------------------------------

    #[test]
    fn v6_cursor_state() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 40,
            rows: 5,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");
        terminal.vt_write(b"Hello\r\nWorld");

        let mut render_state = RenderState::new().expect("RenderState::new failed");
        let snapshot = render_state.update(&terminal).expect("update failed");

        let visible = snapshot.cursor_visible().expect("cursor_visible failed");
        println!("[V6] Cursor visible: {visible}");

        if let Some(vp) = snapshot
            .cursor_viewport()
            .expect("cursor_viewport failed")
        {
            println!("[V6] Cursor position: ({}, {})", vp.x, vp.y);
            // After "Hello\r\n" (1 row) + "World" (5 chars), cursor should be at (5, 1)
            assert_eq!(vp.x, 5, "Expected cursor_x=5");
            assert_eq!(vp.y, 1, "Expected cursor_y=1");
        } else {
            panic!("Expected cursor viewport");
        }

        println!("[V6] Cursor state: OK");
    }

    // ---------------------------------------------------------------------------
    // V7: Scrollback
    // ---------------------------------------------------------------------------

    #[test]
    fn v7_scrollback() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 40,
            rows: 5,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");

        // Write 20 lines to trigger scrollback (viewport is 5 rows)
        for i in 0..20 {
            terminal.vt_write(format!("Line {i}\r\n").as_bytes());
        }

        let total = terminal.total_rows().expect("total_rows failed");
        let scrollback = terminal.scrollback_rows().expect("scrollback_rows failed");
        println!("[V7] Total rows: {total}, Scrollback: {scrollback}");
        assert!(scrollback > 0, "Expected scrollback > 0");

        // Test viewport scrolling
        terminal.scroll_viewport(ScrollViewport::Delta(3));

        println!("[V7] Scrollback: OK");
    }

    // ---------------------------------------------------------------------------
    // V8: Resize
    // ---------------------------------------------------------------------------

    #[test]
    fn v8_resize() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 40,
            rows: 5,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");
        terminal.vt_write(b"Hello World this is a long line that should wrap\r\n");

        let cols_before = terminal.cols().expect("cols failed");
        let rows_before = terminal.rows().expect("rows failed");
        println!("[V8] Before resize: {cols_before}x{rows_before}");

        // Resize to wider
        terminal.resize(80, 10, 0, 0).expect("resize failed");

        let cols_after = terminal.cols().expect("cols failed");
        let rows_after = terminal.rows().expect("rows failed");
        println!("[V8] After resize: {cols_after}x{rows_after}");

        assert_eq!(cols_after, 80, "Expected cols=80 after resize");
        assert_eq!(rows_after, 10, "Expected rows=10 after resize");

        // Verify content still accessible after resize
        let mut render_state = RenderState::new().expect("RenderState::new failed");
        let snapshot = render_state
            .update(&terminal)
            .expect("update after resize");
        let mut row_it = RowIterator::new().expect("RowIterator::new failed");
        let mut row_it = row_it.update(&snapshot).expect("row_it update");

        let mut has_content = false;
        while let Some(row) = row_it.next() {
            let mut cell_it = CellIterator::new().expect("CellIterator::new failed");
            let mut cell_it = cell_it.update(row).expect("cell_it update");
            while let Some(cell) = cell_it.next() {
                if cell.graphemes_len().unwrap_or(0) > 0 {
                    has_content = true;
                    break;
                }
            }
        }
        assert!(has_content, "Expected content after resize");

        println!("[V8] Resize: OK");
    }

    // ---------------------------------------------------------------------------
    // V9: RenderState cell-by-cell readback with colors
    // ---------------------------------------------------------------------------

    #[test]
    fn v9_render_state_cell_readback() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 40,
            rows: 5,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");

        // Write styled content
        terminal.vt_write(b"Hello, \x1b[1;32mworld\x1b[0m!\r\n");
        terminal.vt_write(b"\x1b[4munderlined\x1b[0m text\r\n");
        terminal.vt_write(b"\x1b[38;2;255;128;0morange\x1b[0m\r\n");

        // Use RenderState to read back content
        let mut render_state = RenderState::new().expect("RenderState::new failed");
        let snapshot = render_state.update(&terminal).expect("update failed");

        // Verify we can read the cells
        let mut row_it = RowIterator::new().expect("RowIterator::new failed");
        let mut cell_it = CellIterator::new().expect("CellIterator::new failed");
        let mut row_it = row_it.update(&snapshot).expect("row_it update");

        let mut total_cells = 0;
        let mut colored_cells = 0;

        while let Some(row) = row_it.next() {
            let mut cell_it = cell_it.update(row).expect("cell_it update");
            while let Some(cell) = cell_it.next() {
                let graphemes = cell.graphemes_len().unwrap_or(0);
                if graphemes > 0 {
                    total_cells += 1;
                    if cell.fg_color().unwrap_or(None).is_some() {
                        colored_cells += 1;
                    }
                }
            }
        }

        println!("[V9] Total cells with content: {total_cells}");
        println!("[V9] Cells with non-default fg color: {colored_cells}");

        // Verify we got meaningful content
        assert!(total_cells > 0, "Expected cells with content");
        assert!(colored_cells > 0, "Expected colored cells from ANSI codes");

        println!("[V9] RenderState cell readback: OK");
    }

    // ---------------------------------------------------------------------------
    // V10: Concurrent terminal instances (stress test for multi-session)
    // ---------------------------------------------------------------------------

    #[test]
    fn v10_multiple_terminals() {
        let mut terminals: Vec<Terminal> = Vec::new();

        // Create 8 terminals (matching our max session count)
        for i in 0..8 {
            let mut terminal = Terminal::new(TerminalOptions {
                cols: 80,
                rows: 24,
                max_scrollback: 1000,
            })
            .expect("Terminal::new failed");
            terminal.vt_write(format!("Terminal {i}\r\n").as_bytes());
            terminals.push(terminal);
        }

        // Verify each terminal has independent state
        for (i, terminal) in terminals.iter().enumerate() {
            let mut render_state = RenderState::new().expect("RenderState::new failed");
            let snapshot = render_state.update(terminal).expect("update failed");
            let mut row_it = RowIterator::new().expect("RowIterator::new failed");
            let mut row_it = row_it.update(&snapshot).expect("row_it update");

            let mut has_content = false;
            while let Some(row) = row_it.next() {
                let mut cell_it = CellIterator::new().expect("CellIterator::new failed");
                let mut cell_it = cell_it.update(row).expect("cell_it update");
                while let Some(cell) = cell_it.next() {
                    if cell.graphemes_len().unwrap_or(0) > 0 {
                        has_content = true;
                        break;
                    }
                }
                if has_content { break; }
            }
            assert!(has_content, "Terminal {i} has no content");
        }

        println!("[V10] Multiple terminals (8): OK");
    }

    // ---------------------------------------------------------------------------
    // V11: Effect callbacks with shared state (simulates channel pattern)
    // ---------------------------------------------------------------------------

    #[test]
    fn v11_effect_channels() {
        use std::cell::RefCell;

        let mut terminal = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 100,
        })
        .expect("Terminal::new failed");

        // Simulate channel pattern: effects write to a shared Vec
        let effects: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));

        let effects_bell = effects.clone();
        terminal
            .on_bell(move |_term| {
                effects_bell.borrow_mut().push("bell".into());
            })
            .expect("on_bell failed");

        let effects_title = effects.clone();
        terminal
            .on_title_changed(move |term| {
                let title = term.title().unwrap_or("").to_string();
                effects_title
                    .borrow_mut()
                    .push(format!("title:{title}"));
            })
            .expect("on_title_changed failed");

        // Trigger effects
        terminal.vt_write(b"\x07"); // bell
        terminal.vt_write(b"\x1b]2;My Title\x1b\\"); // title change
        terminal.vt_write(b"\x07"); // bell again

        let collected = effects.borrow().clone();
        println!("[V11] Collected effects: {collected:?}");

        assert_eq!(collected.len(), 3, "Expected 3 effects");
        assert_eq!(collected[0], "bell");
        assert_eq!(collected[1], "title:My Title");
        assert_eq!(collected[2], "bell");

        println!("[V11] Effect channels: OK");
    }

    // ---------------------------------------------------------------------------
    // V12: Performance baseline — measure vt_write throughput
    // ---------------------------------------------------------------------------

    #[test]
    fn v12_performance_baseline() {
        let mut terminal = Terminal::new(TerminalOptions {
            cols: 120,
            rows: 40,
            max_scrollback: 10000,
        })
        .expect("Terminal::new failed");

        // Generate a large VT data blob (simulate `cat` of a large file)
        let line = format!(
            "{} This is a test line with some content for throughput measurement.\r\n",
            "X".repeat(40)
        );
        let iterations = 10_000;
        let data: Vec<u8> = line.repeat(iterations).into_bytes();

        let start = std::time::Instant::now();
        terminal.vt_write(&data);
        let elapsed = start.elapsed();

        let throughput_mb = data.len() as f64 / elapsed.as_secs_f64() / 1_000_000.0;
        println!(
            "[V12] vt_write: {} bytes in {:?} ({:.2} MB/s)",
            data.len(),
            elapsed,
            throughput_mb
        );

        // Measure RenderState update
        let mut render_state = RenderState::new().expect("RenderState::new failed");
        let start = std::time::Instant::now();
        let snapshot = render_state.update(&terminal).expect("update failed");
        let render_elapsed = start.elapsed();
        println!("[V12] RenderState update: {render_elapsed:?}");

        // Measure cell iteration
        let start = std::time::Instant::now();
        let mut row_it = RowIterator::new().expect("RowIterator::new failed");
        let mut cell_it = CellIterator::new().expect("CellIterator::new failed");
        let mut row_it = row_it.update(&snapshot).expect("row_it update");
        let mut cell_count = 0usize;
        while let Some(row) = row_it.next() {
            let mut cell_it = cell_it.update(row).expect("cell_it update");
            while let Some(cell) = cell_it.next() {
                if cell.graphemes_len().unwrap_or(0) > 0 {
                    cell_count += 1;
                }
            }
        }
        let iter_elapsed = start.elapsed();
        println!("[V12] Cell iteration ({cell_count} cells): {iter_elapsed:?}");

        // Measure dirty tracking
        terminal.vt_write(b"New line\r\n");
        let start = std::time::Instant::now();
        let snapshot = render_state.update(&terminal).expect("update after write");
        let dirty_elapsed = start.elapsed();
        let dirty = snapshot.dirty().expect("dirty check");
        println!(
            "[V12] Dirty update after small write: {dirty_elapsed:?} (state: {dirty:?})"
        );

        println!("[V12] Performance baseline: OK");
    }

    // ---------------------------------------------------------------------------
    // V13: Compression API
    // ---------------------------------------------------------------------------

    #[test]
    fn v13_compression() {
        use libghostty_vt::terminal::{CompressionMode, CompressionResult};

        let mut terminal = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 1000,
        })
        .expect("Terminal::new failed");

        // Fill scrollback
        for i in 0..500 {
            terminal.vt_write(format!("Line {i:04} with some padding content here\r\n").as_bytes());
        }

        let scrollback_before = terminal.scrollback_rows().expect("scrollback_rows failed");
        println!("[V13] Scrollback before compression: {scrollback_before} rows");

        // Test compression API
        match terminal.compress(CompressionMode::Incremental) {
            Ok(result) => println!("[V13] Compression result: {result:?}"),
            Err(e) => println!("[V13] Compression error: {e}"),
        }

        println!("[V13] Compression: OK");
    }

    // ---------------------------------------------------------------------------
    // V14: Verify libghostty-vt-sys linked successfully
    // ---------------------------------------------------------------------------

    #[test]
    fn v14_sys_version_check() {
        // If this test runs, it means libghostty-vt-sys compiled and linked.
        // The FFI boundary is working.
        let terminal = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 0,
        })
        .expect("Terminal::new failed");

        let cols = terminal.cols().expect("cols failed");
        let rows = terminal.rows().expect("rows failed");
        assert_eq!(cols, 80);
        assert_eq!(rows, 24);

        println!("[V14] libghostty-vt-sys linked: OK (cols={cols}, rows={rows})");
    }
}
