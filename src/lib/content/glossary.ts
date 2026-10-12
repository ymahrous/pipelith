/** Glossary: one-sentence definitions (also published as a schema.org DefinedTermSet). */

export interface Term {
  id: string;
  term: string;
  definition: string;
  see?: { href: string; label: string };
}

export const GLOSSARY: readonly Term[] = [
  { id: "isa", term: "Instruction set architecture (ISA)", definition: "The contract between software and hardware: the instructions, their encodings, registers, flags and memory a processor must implement.", see: { href: "/isa", label: "The reference ISA" } },
  { id: "reference-model", term: "Reference model", definition: "A simple program that executes the ISA one instruction at a time and defines the correct result; Pipelith compares your hardware against it. Also called a golden model." },
  { id: "pipeline", term: "Pipeline", definition: "Splitting instruction execution into stages so several instructions are in flight at once, one per stage." },
  { id: "stage", term: "Stage", definition: "One step of the pipeline, such as fetch (IF), decode (ID), execute (EX), memory (MEM) or write-back (WB); 6-stage designs split EX into EX1 and EX2." },
  { id: "pipeline-register", term: "Pipeline register", definition: "The register between two stages (for example ID/EX) that carries an instruction's values to the next stage on each clock edge." },
  { id: "hazard", term: "Hazard", definition: "A situation where the next instruction can't safely proceed in the next cycle: a data hazard (it needs a result not yet written), a control hazard (a branch isn't resolved yet) or a structural hazard (two stages need the same hardware)." },
  { id: "forwarding", term: "Forwarding (bypassing)", definition: "Sending a result straight from a later pipeline register back to the execute stage, so a dependent instruction doesn't wait for write-back.", see: { href: "/guide#forwarding", label: "Forwarding settings" } },
  { id: "forwarding-path", term: "Forwarding path", definition: "One connection from a pipeline register (such as EX/MEM or MEM/WB) into the execute stage's operand inputs." },
  { id: "stall", term: "Stall (bubble)", definition: "Holding the front of the pipeline for a cycle and inserting a no-op behind it, used when a hazard can't be solved by forwarding." },
  { id: "load-use", term: "Load-use hazard", definition: "An instruction that needs a value being loaded from memory by the instruction just before it; even with full forwarding it costs one stall on 5 stages and two on 6." },
  { id: "flush", term: "Flush", definition: "Clearing instructions that were fetched after a taken branch, turning them into no-ops." },
  { id: "branch-resolution", term: "Branch resolution", definition: "The stage where a conditional branch knows whether it is taken (EX on 5 stages, EX2 on 6); instructions fetched before that are flushed if it is." },
  { id: "write-through", term: "Write-before-read register file", definition: "A register file that writes in the first half of the cycle and reads in the second, so write-back and decode can share a cycle without a hazard." },
  { id: "hazard-unit", term: "Hazard-detection unit", definition: "Logic in the decode stage that spots hazards forwarding can't cover and stalls or flushes the pipeline." },
  { id: "structural-hazard", term: "Shared memory port", definition: "In a Von Neumann design one memory serves both fetch and data access, so a load or store can delay the next fetch." },
  { id: "immediate-word", term: "Immediate word", definition: "A second instruction word holding a constant (as in LDM or IADD); it takes a fetch slot of its own." },
  { id: "reset-vector", term: "Reset vector", definition: "The memory word (M[0] here) holding the address where execution starts after reset." },
  { id: "testbench", term: "Testbench", definition: "A VHDL, Verilog or SystemVerilog file that instantiates your processor, drives its clock, reset and inputs, and records what happens; Pipelith generates one in your design language." },
  { id: "vcd", term: "VCD (value change dump)", definition: "A standard text file of every signal change over time, written by GHDL, Icarus Verilog, Verilator, ModelSim, Questa and Vivado; Pipelith reads it to compare with the model." },
  { id: "waveform", term: "Waveform", definition: "A picture of signals over time — one row per signal, time running left to right — drawn by a waveform viewer such as GTKWave or Surfer from a VCD file.", see: { href: "/waveforms", label: "Standard test waveforms" } },
  { id: "expected-waveform", term: "Expected waveform", definition: "The waveform a correct design with your pipeline depth and forwarding should produce for a program, built by Pipelith from the reference model and the timing estimate.", see: { href: "/waveforms", label: "Download one" } },
  { id: "sequence-comparison", term: "Sequence comparison", definition: "Comparing the order of distinct values a register takes rather than the exact cycle, so a correct design with different timing still matches." },
  { id: "first-divergence", term: "First divergence", definition: "The earliest point where hardware and model disagree; later differences are usually consequences of it, so fix this one first." },
  { id: "sensitivity-list", term: "Sensitivity list", definition: "The signals that wake a VHDL process or a Verilog always block; an incomplete list makes simulation disagree with synthesised hardware.", see: { href: "/docs/review-rules#sensitivity-incomplete", label: "Review rule" } },
  { id: "latch", term: "Latch", definition: "A level-sensitive memory element that synthesis infers when combinational logic doesn't assign a signal on every path — usually a bug.", see: { href: "/docs/review-rules#latch", label: "Review rule" } },
  { id: "compile-order", term: "Compile order", definition: "The order source files must be compiled in so every package, entity and module exists before it is used; Code review computes it for the hardware kit." },
  { id: "hdl", term: "HDL (hardware description language)", definition: "A language for describing digital circuits: VHDL, Verilog and SystemVerilog are the IEEE-standard ones, and Pipelith works with all three." },
  { id: "rtl", term: "RTL (register-transfer level)", definition: "Hardware described as registers and the logic between them — the synthesizable VHDL or Verilog of your processor, as opposed to a testbench." },
  { id: "entity-module", term: "Entity / module", definition: "One design unit with its ports: an entity (plus architecture) in VHDL, a module in Verilog and SystemVerilog." },
  { id: "always-block", term: "always block", definition: "Verilog's process: always @(posedge clk) describes registers, always @* (always_comb in SystemVerilog) describes combinational logic." },
  { id: "blocking", term: "Blocking and non-blocking assignment", definition: "In Verilog, = updates a variable at once (use it in combinational logic) and <= updates it at the end of the time step (use it for registers in clocked blocks).", see: { href: "/docs/review-rules#ff-blocking", label: "Review rule" } },
  { id: "implicit-net", term: "Implicit net", definition: "A 1-bit wire Verilog creates silently when an undeclared name is used in a connection or assign; `default_nettype none turns that into an error.", see: { href: "/docs/review-rules#implicit-net", label: "Review rule" } },
];
