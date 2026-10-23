import { cookies } from "next/headers";
import { ModeToggle } from "@/components/mode-toggle";
import { PanelPageTitle } from "@/components/panel-page-title";
import { PanelSidebar, type PanelSidebarProps } from "@/components/panel-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Layout of the signed-in panels (merchant and superadmin): collapsible sidebar + page area.
 * `banners` are shown above the page header (impersonation, store status).
 */
export async function PanelShell({
  banners,
  children,
  ...sidebar
}: PanelSidebarProps & { banners?: React.ReactNode; children: React.ReactNode }) {
  // Same cookie the sidebar writes when it is toggled, so it renders collapsed without a flash
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <PanelSidebar {...sidebar} />
        <SidebarInset>
          {banners}
          <header className="sticky top-0 z-10 flex print:hidden h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
            <PanelPageTitle basePath={sidebar.basePath} groups={sidebar.groups} />
            <ModeToggle className="ml-auto" />
          </header>
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
