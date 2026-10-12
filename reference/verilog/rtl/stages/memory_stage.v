`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// Memory: loads, stores and the stack. The stack pointer lives here, so every
// push and pop sees the one before it. While this stage uses the memory port,
// fetch waits (one memory for instructions and data).
module memory_stage (
  input  wire                clk,
  input  wire                reset,          // active low, synchronous
  input  wire [`C_WIDTH-1:0] ctrl_in,
  input  wire [31:0]         result_in,      // load/store address
  input  wire [31:0]         data_in,        // data to store or push
  input  wire [31:0]         imm_in,         // vector address
  input  wire [31:0]         rdata,
  output wire                access,
  output wire [31:0]         addr,
  output wire                we,
  output wire [31:0]         wdata,
  output wire                jump,
  output wire [31:0]         jump_target,
  output wire                flags_we,
  output wire [2:0]          flags_out,
  output reg  [31:0]         sp
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

  always @(posedge clk) begin
    if (!reset)                          sp <= 32'h00000FFF;
    else if (valid && op == `MEM_PUSH)   sp <= sp - 32'd1;
    else if (valid && op == `MEM_POP)    sp <= sp + 32'd1;
  end
endmodule

`default_nettype wire
