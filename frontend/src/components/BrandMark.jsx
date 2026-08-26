/** Product mark: three ascending bars. Inherits colour from its parent. */
export default function BrandMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <rect x="7" y="16" width="4" height="9" rx="1.5" fill="#fff" />
      <rect x="14" y="11" width="4" height="14" rx="1.5" fill="#fff" />
      <rect x="21" y="7" width="4" height="18" rx="1.5" fill="#fff" />
    </svg>
  )
}
