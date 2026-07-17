import './globals.css';

export const metadata = {
  title: 'Visual Regression Fixture',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
