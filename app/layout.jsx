export const metadata = {
  title: "Absensi Sholat Dzuhur — Login NIS",
  description: "Absensi Sholat Dzuhur dengan login NIS, scan QR, riwayat, dan statistik.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
