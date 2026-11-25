import './globals.css';

export const metadata = {
  title: 'Transportplanung',
  appleWebApp: { capable: true, title: 'Touren', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f5c42' };

export default function RootLayout({ children }) {
  return (
    <html lang="de-CH">
      <body>{children}</body>
    </html>
  );
}
