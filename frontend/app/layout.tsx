import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Veo Studio',
  description: 'Local Automation Suite for VideoFX',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
