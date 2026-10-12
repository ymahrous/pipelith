`timescale 1ns / 1ps
`default_nettype none

// Fetch: the program counter and what happens to it each cycle. During reset
// the memory address is held at 0, so PC loads the reset vector M[0].
// Jumps are taken in priority order: MEM (RET, RTI, interrupt vectors), EX
// (taken conditional branches), then decode (JMP, CALL).
module fetch_stage (
  input  logic        clk,
  input  logic        reset,         // active low, synchronous
  input  logic [31:0] fetch_word,    // word on the memory bus this cycle
  input  logic        fetch_free,    // MEM is not using the memory port
  input  logic        hold,          // decode keeps its instruction (stall or more micro-ops)
  input  logic        fetch_stop,    // halted, or waiting for a jump from MEM
  input  logic        consume_imm,   // decode used the fetched word as its immediate
  input  logic        id_jump,
  input  logic [31:0] id_target,
  input  logic        ex_jump,
  input  logic [31:0] ex_target,
  input  logic        mem_jump,
  input  logic [31:0] mem_target,
  output logic [31:0] pc,
  output logic        fetch_valid,   // IF/ID takes the fetched word
  output logic        flush          // IF/ID takes a bubble
);
  assign flush       = mem_jump || ex_jump || id_jump || consume_imm;
  assign fetch_valid = fetch_free && !hold && !fetch_stop && !flush;

  always_ff @(posedge clk) begin
    if (!reset)                        pc <= fetch_word;
    else if (mem_jump)                 pc <= mem_target;
    else if (ex_jump)                  pc <= ex_target;
    else if (id_jump)                  pc <= id_target;
    else if (consume_imm || fetch_valid) pc <= pc + 32'd1;
  end
endmodule

`default_nettype wire
