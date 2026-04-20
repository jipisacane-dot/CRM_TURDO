/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          main: "#0D0D0D",
          card: "#181818",
          input: "#222222",
          hover: "#1F1F1F",
        },
        crimson: {
          DEFAULT: "#8B1F1F",
          light: "#A52525",
          bright: "#C42E2E",
          50: "#FFF0F0",
        },
        border: "#2E2E2E",
        muted: "#666666",
      },
    },
  },
  plugins: [],
};
