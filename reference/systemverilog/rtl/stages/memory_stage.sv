`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.svh"

// Memory: loads, stores and the stack. The stack pointer lives here, so every
// push and pop sees the one before it. While this stage uses the memory port,
// fetch waits (one memory for instructions and data).
module memory_stage (
  input  logic                clk,
  input  logic                reset,          // active low, synchronous
  input  logic [`C_WIDTH-1:0] ctrl_in,
  input  logic [31:0]         result_in,      // load/store address
  input  logic [31:0]         data_in,        // data to store or push
  input  logic [31:0]         imm_in,         // vector address
  input  logic [31:0]         rdata,
  output logic                access,
  output logic [31:0]         addr,
  output logic                we,
  output logic [31:0]         wdata,
  output logic                jump,
  output logic [31:0]         jump_target,
  output logic                flags_we,
  output logic [2:0]          flags_out,
  output logic [31:0]         sp
);
  wire       valid  = ctrl_in[`C_VALID];
  wire [2:0] op     = ctrl_in[`C_MEMOP];
  wire [1:0] popdst = ctrl_in[`C_POPDST];

  assign access      = valid && op != `MEM_NONE;
  assign addr        = (op == `MEM_PUSH)   ? sp :
                       (op == `MEM_POP)    ? sp + 32'd1 :
                       (op == `MEM_VECTOR) ? imm_in : result_in;
  assign we          = valid && (op == `MEM_STORE || op == `MEM_PUSH);
  assign wdata       = data_in;
  assign jump        = valid && ((op == `MEM_POP && popdst == `POP_PC) || op == `MEM_VECTOR);
  assign jump_target = rdata;
  assign flags_we    = valid && op == `MEM_POP && popdst == `POP_FLAGS;
  assign flags_out   = rdata[2:0];

  always_ff @(posedge clk) begin
    if (!reset)                          sp <= 32'h00000FFF;
    else if (valid && op == `MEM_PUSH)   sp <= sp - 32'd1;
    else if (valid && op == `MEM_POP)    sp <= sp + 32'd1;
  end
endmodule

`default_nettype wire
