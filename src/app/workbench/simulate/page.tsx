import type { Metadata } from "next";
import { SimulateStep } from "@/components/steps-ui/SimulateStep";

export const metadata: Metadata = {
  title: "Simulate",
  description: "Step through a program on the reference ISA model and see a pipeline timing estimate and diagram for 5 or 6 stages.",
  alternates: { canonical: "/workbench/simulate" },
};

export default function Page() {
  return <SimulateStep />;
}
