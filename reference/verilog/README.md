# Pipelith 5-stage reference processor (Verilog)

A small, readable 5-stage pipelined implementation of the 32-bit RISC instruction set that Pipelith's reference model defines (8 registers, 4096-word memory, Z/N/C flags, IN/OUT ports, one external interrupt). It exists so you can see a complete design that passes every check — and so Pipelith can test its Verilog testbench, scripts and code review against real RTL.

| | |
| --- | --- |
| Language | Verilog-2005 (IEEE 1364-2005). A SystemVerilog copy lives in `../systemverilog`. |
| Stages | IF → ID → EX → MEM → WB |
| Forwarding | Full: EX/MEM and MEM/WB into EX; the register file writes before it reads |
| Hazards | One-cycle load-use stall; conditional branches resolve in EX (one wrong-path fetch flushed); JMP/CALL resolve in decode |
| Memory | One port for instructions and data (Von Neumann); a load or store in MEM delays fetch by a cycle |
| Reset | Active low and synchronous; PC loads M[0] while reset is held |

## Files

```
rtl/
├── isa_defs.vh                 opcodes and the micro-op control word
├── processor.v                 top level: wires the stages together
├── components/                 memory, register file, ALU, control, forwarding and hazard units
├── pipeline_registers/         if_id, id_ex, ex_mem, mem_wb (each with stall and flush)
└── stages/                     fetch, decode, execute, memory, writeback
```

Every instruction becomes one or more micro-ops in decode. SWAP takes two, RTI two, INT three, and an external interrupt two; RET, RTI, INT and interrupts stop fetch until the MEM stage has read the new PC.

## Run it

Open the bundled test programs in Pipelith's workbench with **Verilog** selected and **5 stages**, download the hardware kit from the Compare step, and run:

```bash
./run_icarus.sh path/to/reference/verilog/rtl     # Icarus Verilog
./run_verilator.sh path/to/reference/verilog/rtl  # Verilator 5
```

Drop the `wave.vcd` it writes into Compare: every register, SP, the flags, the OUT port and the fetch PC match the reference model, and the cycle counts fit the 5-stage estimate.

MIT License, part of Pipelith.
