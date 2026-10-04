/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#1E2329",
        panel: "#161B20",
        accent: "#00F0FF",
        mint: "#3DF0A8",
        dimmed: "#8A93A0",
      },
      typography: (theme) => ({
        invert: {
          css: {
            // The plugin draws backticks around inline code with CSS content.
            // They are not in the DOM, so only the config can remove them.
            "code::before": { content: "none" },
            "code::after": { content: "none" },

            "--tw-prose-body": "#C9D1D9",
            "--tw-prose-headings": "#FFFFFF",
            "--tw-prose-lead": "#B9C4CF",
            "--tw-prose-links": theme("colors.accent"),
            "--tw-prose-bold": "#FFFFFF",
            "--tw-prose-counters": theme("colors.accent"),
            "--tw-prose-bullets": theme("colors.accent"),
            "--tw-prose-hr": "rgba(255, 255, 255, 0.10)",
            "--tw-prose-quotes": "#B9C4CF",
            "--tw-prose-quote-borders": theme("colors.mint"),
            "--tw-prose-captions": theme("colors.dimmed"),
            "--tw-prose-code": theme("colors.accent"),
            "--tw-prose-pre-code": "#E6EDF3",
            "--tw-prose-pre-bg": "#0D1117",
            "--tw-prose-th-borders": "rgba(255, 255, 255, 0.15)",
            "--tw-prose-td-borders": "rgba(255, 255, 255, 0.08)",

            h1: { marginBottom: "0.6em", letterSpacing: "-0.01em" },
            h2: {
              marginTop: "1.8em",
              paddingBottom: "0.25em",
              borderBottom: "1px solid rgba(255, 255, 255, 0.10)",
              letterSpacing: "-0.01em",
            },
            h3: { color: theme("colors.accent"), marginTop: "1.6em" },
            h4: { color: theme("colors.mint") },

            code: {
              backgroundColor: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "4px",
              padding: "0.12em 0.35em",
              fontWeight: "500",
              fontSize: "0.85em",
            },
            "pre code": {
              backgroundColor: "transparent",
              border: "none",
              padding: "0",
              fontSize: "inherit",
              color: "inherit",
            },
            pre: {
              backgroundColor: "#0D1117",
              border: "1px solid rgba(255, 255, 255, 0.10)",
              borderRadius: "8px",
              padding: "14px 16px",
              lineHeight: "1.6",
            },

            a: {
              textDecorationThickness: "1px",
              textUnderlineOffset: "2px",
              fontWeight: "500",
            },
            blockquote: {
              fontStyle: "normal",
              borderLeftWidth: "3px",
              paddingLeft: "1em",
            },
            "ol > li::marker": { fontWeight: "600" },
            "ul > li::marker": { fontSize: "1em" },
            "li > p": { marginTop: "0.4em", marginBottom: "0.4em" },

            table: { fontSize: "0.9em" },
            "thead th": {
              color: theme("colors.dimmed"),
              textTransform: "uppercase",
              fontSize: "0.72em",
              letterSpacing: "0.06em",
            },
            "tbody tr": { borderBottom: "1px solid rgba(255, 255, 255, 0.06)" },
            td: { paddingTop: "0.5em", paddingBottom: "0.5em" },

            hr: { marginTop: "2.4em", marginBottom: "2.4em" },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
