/**
 * Product help docs for UI (Settings → Help).
 * Bodies are generated from docs/product/ (+ locales) — see yarn product:content.
 *
 * Agent embeds stay English in packages/sidecar; UI uses getProductHelpPack(language).
 */
export {
  HIP_PRODUCT_VERSION,
  HIP_SKILL_DESCRIPTION,
  PRODUCT_CAPABILITY_MAP,
  PRODUCT_HELP_LOCALES,
  PRODUCT_HELP_SECTIONS,
  PRODUCT_SKILL_VERSION,
  getProductHelpPack,
  resolveProductHelpLocale,
  type ProductHelpLocale,
  type ProductHelpLocalePack,
  type ProductHelpSection,
  type ProductHelpSectionId,
} from './productDocs.generated'
