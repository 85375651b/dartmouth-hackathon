import { PackWiseDashboard } from "@/components/PackWiseDashboard";
import { PackWiseProvider } from "@/state/packwise-store";

export default function HomePage() {
  return (
    <PackWiseProvider>
      <PackWiseDashboard />
    </PackWiseProvider>
  );
}
