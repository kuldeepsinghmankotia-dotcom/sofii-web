// Deliberately NOT a 'use client' module, and deliberately separate from
// theme-provider.tsx.
//
// layout.tsx is a Server Component that inlines these values into the
// no-flash <script>. Importing a plain constant from a 'use client'
// module into a Server Component does not give you the value — it gives a
// client reference, which serialized as the literal text `undefined` and
// produced `setAttribute('data-theme', undefined)` in the emitted script.
// That set data-theme to the string "undefined", which matches no theme
// selector, so light mode silently never applied on load.
export type Theme = 'dark' | 'light'

// Same key next-themes used, so anyone who already picked a theme keeps
// it — swapping the implementation must not silently reset preferences.
export const THEME_STORAGE_KEY = 'theme'
export const DEFAULT_THEME: Theme = 'dark'
