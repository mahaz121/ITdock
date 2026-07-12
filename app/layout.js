import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'ITdock — IT Asset Management',
  description: 'Modern IT Asset Management for forward-thinking teams',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
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
