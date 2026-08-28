import './globals.css';

export const metadata = { title: 'Deccan Dental Inventory' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
