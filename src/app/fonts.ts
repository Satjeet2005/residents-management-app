import localFont from "next/font/local";

/*
 * IBM Plex Sans and IBM Plex Sans Devanagari (SIL Open Font License 1.1), from the
 * @fontsource packages, weights 400 and 600 only. next/font/local copies the files
 * into the build, so no font is fetched from a network. Each script subset is its
 * own font with the unicode-range of that subset, so a page downloads the
 * Latin Extended or Devanagari file only when it shows a character from it. The
 * rupee sign U+20B9 is in Latin Extended. The options must be written out in full:
 * next/font reads them at build time and cannot follow variables.
 */
export const plexLatin = localFont({
  src: [
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-latin",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

export const plexLatinExt = localFont({
  src: [
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-latin-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

export const plexDevanagari = localFont({
  src: [
    { path: "../../node_modules/@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-devanagari",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09" }],
});

/** The class names that define the three font variables; put them on <html>. */
export const fontVariables = [plexLatin.variable, plexLatinExt.variable, plexDevanagari.variable].join(" ");
