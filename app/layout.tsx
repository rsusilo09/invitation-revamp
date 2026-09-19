import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reinaldo & Eunike — Wedding Invitation',
  description: '#REunited',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Fonts used throughout the storyboard/scrapbook — loaded at runtime
            via <link>, matching the prototype's <helmet>, rather than
            next/font (which fetches at build time and needs network then). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
