/** CSS Modules type shim for the client bundle (lightningcss transform). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}