import { Pipeline } from "@/components/Pipeline";

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Pipeline />
      {children}
    </>
  );
}
