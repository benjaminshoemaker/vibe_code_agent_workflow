import NextDynamic from "next/dynamic";

const Shell = NextDynamic(() => import("../../components/Shell"), { ssr: false });

export const dynamic = "force-dynamic";

export default function AppPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* SSR skeleton so E2E can locate the shell container before hydration */}
      <div data-testid="app-shell-skeleton" className="sr-only">App shell</div>
      <Shell />
    </main>
  );
}
