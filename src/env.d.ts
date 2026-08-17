/** Ambient types for CSS module imports (matches the tsdown css-loader). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
