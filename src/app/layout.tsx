import "./globals.css";
import { Mona_Sans, Geist_Mono } from "next/font/google";
import Nav from "../components/Nav";
import { SetupProvider } from "../components/SetupContext";

const mona = Mona_Sans({ subsets: ["latin"], variable: "--font-mona", axes: ["wdth"] });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata = { title: "pullpage-bot" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mona.variable} ${mono.variable}`}>
      <body>
        <SetupProvider>
          <Nav />
          {children}
        </SetupProvider>
      </body>
    </html>
  );
}
