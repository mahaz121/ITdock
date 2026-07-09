import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'ITdock — IT Asset Management',
  description: 'Modern IT Asset Management for forward-thinking teams',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%230d9488'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='18' font-family='system-ui,sans-serif' fill='white' font-weight='700'>IT</text></svg>",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
