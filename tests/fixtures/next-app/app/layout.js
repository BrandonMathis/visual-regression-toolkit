import './globals.css';

export const metadata = {
  title: 'Visual Regression Fixture',
  description: 'Deterministic fixture app for the visual regression toolkit.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
