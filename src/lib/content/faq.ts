/**
 * FAQ content: rendered on /faq, emitted as FAQPage structured data, and
 * listed in /llms.txt. Each answer starts with the direct answer (for answer
 * engines), then adds detail.
 */
export interface FaqItem {
  q: string;
  a: string;
  group: "Basics" | "Uploads" | "Pipeline" | "Results" | "Privacy & security";
}

export const FAQ: FaqItem[] = [
  {
    group: "Basics",
    q: "What is Pipelith?",
    a: "Pipelith is a free web app for validating and testing pipelined RISC processors written in VHDL, Verilog or SystemVerilog. It reviews your code for bugs and suggests fixes, runs programs on a reference model of the instruction set, shows the waveform a correct pipeline should produce, and compares your design's simulation with the model to find the first instruction where they disagree.",
  },
  {
    group: "Basics",
    q: "What is the fastest way to try it?",
    a: "Click Run the demo on the home page (or open /try). It loads a bundled test program and a GHDL waveform of the reference processor and shows the comparison — including a real PUSH bug — with no files and no setup.",
  },
  {
    group: "Basics",
    q: "Can I just drop my files somewhere?",
    a: "Yes. Drop files on the home page and Pipelith opens each where it belongs: a .zip or .vhd, .v or .sv files go to Code review, an .asm or .mem program to Assemble, a program together with its wave.vcd (or a .txt of final register values) straight to Compare.",
  },
  {
    group: "Basics",
    q: "Do I need an account?",
    a: "No. There is no sign-up, login or account of any kind. Open the site and start; your work is kept in your own browser.",
  },
  {
    group: "Basics",
    q: "Is it free?",
    a: "Yes. The app is free to use and its source code is available under the MIT License.",
  },
  {
    group: "Basics",
    q: "Which processors does it support?",
    a: "It ships with a profile for a 32-bit pipelined RISC processor (8 registers, 4096-word memory, Z/N/C flags) and works with 5-stage (IF ID EX MEM WB) and 6-stage (IF ID EX1 EX2 MEM WB) pipelines. Other designs with the same instruction set work directly; a different instruction set needs a new profile in the source code.",
  },
  {
    group: "Basics",
    q: "Which design languages does it support?",
    a: "VHDL, Verilog and SystemVerilog. Choose yours with HDL at the top of any page: the hardware kit, sample codebases and examples follow it. Code review reads every language it finds, so mixed VHDL and Verilog designs work too.",
  },
  {
    group: "Basics",
    q: "Which simulators can I use for the hardware step?",
    a: "The hardware kit has ready-made scripts for GHDL (VHDL), Icarus Verilog and Verilator (Verilog and SystemVerilog), and ModelSim or Questa (all three). The Vivado simulator works with the commands in the guide, and anything else that writes a standard VCD file works as well.",
  },
  {
    group: "Basics",
    q: "I'm new to digital design. Where do I start?",
    a: "Start with Getting started in the docs: it explains what a pipeline is, which free tools to install for your language, and walks you through a first check in about ten minutes. Every term has a one-sentence definition in the glossary.",
  },
  {
    group: "Basics",
    q: "Is Pipelith accessible?",
    a: "Yes, it aims to meet WCAG 2.2 level AA: everything works with a keyboard and a screen reader, and Display settings at the top of every page offer dark mode, larger text, a high-legibility typeface (Atkinson Hyperlegible) and reduced motion. The accessibility statement lists known limitations and how to report a problem.",
  },
  {
    group: "Uploads",
    q: "What do I need to upload for a code review?",
    a: "Upload your whole design: every .vhd/.vhdl, .v or .sv file, including all packages, `include headers (.vh, .svh) and components, as a .zip, a folder or individual files. Any folder layout works. Testbenches and .asm programs may be included; other files are ignored.",
  },
  {
    group: "Uploads",
    q: "How should I structure the .zip file?",
    a: "Put all source files of one design (VHDL, Verilog or SystemVerilog) in one folder (subfolders are fine) and zip that folder. Include every package and header your files use and every unit they instantiate. Leave out zips inside the zip, password protection and other archive formats. The Code review page has an example layout for your language and step-by-step instructions for Windows, macOS and Linux.",
  },
  {
    group: "Uploads",
    q: "Why does the review say a package or unit is missing?",
    a: "Because a file uses a package (use work.name, import name::*), includes a header (`include) or instantiates an entity or module that no uploaded file defines. Add that file to the upload and run the review again. Vendor primitives (unisim, BUFG, altsyncram and similar) are reported as warnings because they can't be included.",
  },
  {
    group: "Uploads",
    q: "Does it review Verilog or SystemVerilog?",
    a: "Yes. Verilog-2005 and SystemVerilog files are reviewed after macros, `ifdef and `include are expanded. Besides the checks VHDL gets (connections, widths, multiple drivers, latches, sensitivity lists, pipeline structure), Verilog has its own: blocking assignments in clocked blocks, non-blocking ones in combinational logic, wires assigned in always blocks, regs driven by assign, implicit 1-bit nets and always blocks with no events.",
  },
  {
    group: "Uploads",
    q: "My upload isn't structured the way the review wants. Can an AI help?",
    a: "Yes. When the structure check finds a problem — or nothing could be read — it offers a ready-made prompt for any AI assistant (ChatGPT, Claude, Gemini, Copilot …). The prompt lists your file names, your language and depth, and what was wrong, and asks for the moves and a script to make them; it contains none of your code, and Pipelith never sends it anywhere: you copy it yourself.",
  },
  {
    group: "Pipeline",
    q: "What do the forwarding settings change?",
    a: "They tell the workbench which results your design can bypass to the execute stage: full forwarding, only some paths, or none. The setting changes the cycle estimate and stall breakdown, the testbench length, the timing verdict on your waveform, and which forwarding and hazard units the code review expects.",
  },
  {
    group: "Pipeline",
    q: "What is the difference between the 5-stage and 6-stage settings?",
    a: "The instruction set and every correctness check are the same. The 6-stage pipeline splits execute into EX1 and EX2, so it has one more pipeline register, an extra forwarding path, branches resolved one stage later and a longer load-use stall. Pick the depth your design has.",
  },
  {
    group: "Pipeline",
    q: "How accurate is the cycle estimate?",
    a: "It models an in-order pipeline with the forwarding you select, load-use and branch stalls, immediate-word fetches, a shared memory port and multi-cycle instructions. On the reference 6-stage design it matches GHDL exactly for the one-operand test. Treat it as a guide: real designs can stall for reasons the model doesn't know.",
  },
  {
    group: "Results",
    q: "How does the waveform comparison work if my pipeline has different timing?",
    a: "It compares the sequence of values each register, the stack pointer, the flags and the OUT port take, not the cycle in which they change. If R3 goes 0, 19, 5 in the model it must go 0, 19, 5 in the waveform, whenever that happens.",
  },
  {
    group: "Results",
    q: "Can I see what a correct waveform looks like?",
    a: "Yes. Download an expected waveform: what a correct 5- or 6-stage design with your forwarding setting should show, built from the reference model and the timing estimate. Simulate has one for the open program, and the Standard test waveforms page has them for every standard test, along with real simulations of the bundled VHDL and Verilog reference designs.",
  },
  {
    group: "Results",
    q: "Can I test without generating a waveform?",
    a: "Yes. Type or upload the final register values your design ends with, and the workbench checks them against the reference model. That tells you whether the result is right, not where it went wrong.",
  },
  {
    group: "Results",
    q: "Can the code review prove my processor is correct?",
    a: "No. It is static analysis that catches structural and connection mistakes and risky patterns. Logic bugs — a wrong mux select, a mis-wired branch target — show up when you run programs and compare waveforms.",
  },
  {
    group: "Privacy & security",
    q: "Are my files uploaded to a server?",
    a: "No. Code, programs, waveforms and reports are read and processed inside your browser and never sent to a server. The server only delivers the app itself.",
  },
  {
    group: "Privacy & security",
    q: "Does the site use cookies or tracking?",
    a: "It sets no cookies. When hosted on Vercel it uses Vercel Web Analytics and Speed Insights, which count page views and measure page speed without cookies; URLs are reduced to the page path before anything is sent, and nothing is sent if you use Do Not Track, Global Privacy Control or the opt-out switch on the privacy page.",
  },
  {
    group: "Privacy & security",
    q: "Is it safe to run the generated scripts?",
    a: "Yes, they are short and only call the simulator (GHDL, Icarus Verilog, Verilator or ModelSim) on the files in the kit and the folder you name. Every value placed in them is checked against a strict allow-list, and you can read them before running.",
  },
];
