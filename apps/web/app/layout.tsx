import './globals.css';

import { Inter } from 'next/font/google';

import { ReactNode } from 'react';

import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata = {
  metadataBase: new URL(appUrl),
  title: 'NuraviewCRM',
  description: 'Internal CRM.',
  manifest: '/manifest.webmanifest',
  openGraph: {
    images: [
      {
        url: '/images/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'NuraviewCRM',
      },
    ],
  },
  twitter: {
    cardType: 'summary_large_image',
    image: '/images/opengraph-image.png',
    width: 1200,
    height: 630,
    alt: 'NuraviewCRM',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={inter.className + ' min-h-screen'}>
        <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
          {children}
        </ThemeProvider>
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  );
}
