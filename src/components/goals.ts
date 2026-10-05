import type { Goal } from "@/lib/session/session";

export interface GoalInfo {
  id: Goal;
  title: string;
  blurb: string;
  needs: string[];
  steps: string;
}

/** The three ways to use the workbench, and exactly what each one needs from the user. */
export const GOALS: GoalInfo[] = [
  {
    id: "sample",
    title: "Try it with a bundled test",
    blurb: "See the whole flow on the reference processor in about a minute.",
    needs: ["Nothing. A test program and a GHDL waveform of the reference design are included."],
    steps: "All six steps, using the bundled files",
  },
  {
    id: "program",
    title: "Check a program",
    blurb: "Assemble and run a program on the reference model, and test the expectations written in its comments.",
    needs: ["Your program: an .asm source file, or an assembled .mem image"],
    steps: "Program → Assemble → Simulate → Check → Report",
  },
  {
    id: "hardware",
    title: "Test my processor",
    blurb: "Everything in “Check a program”, then compare your design's simulation with the model.",
    needs: [
      "Your program: an .asm source file, or an assembled .mem image",
      "Results from your design — one of: a wave.vcd waveform (the kit in step 5 makes one), or the final register values",
      "To make the waveform: your RTL folder and GHDL or ModelSim/Questa",
    ],
    steps: "All six steps",
  },
];

export const goalInfo = (g: Goal) => GOALS.find((x) => x.id === g) ?? GOALS[2];

/** Code review is a separate path: it needs only the RTL, no program. */
export const REVIEW_OPTION = {
  title: "Review my code",
  blurb: "Scan your RTL for bugs, connection mistakes and risky patterns, with a suggested fix for each.",
  needs: ["Your VHDL codebase: a .zip, a folder, or the .vhd files themselves"],
  href: "/review",
};
