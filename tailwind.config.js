/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          main:  "#F8F9FB",
          card:  "#FFFFFF",
          input: "#F1F3F7",
          hover: "#F1F3F7",
        },
        crimson: {
          DEFAULT: "#8B1F1F",
          light:   "#A52525",
          bright:  "#C42E2E",
          50:      "#FFF0F0",
        },
        border: "#E4E7EF",
        muted:  "#8492A6",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
