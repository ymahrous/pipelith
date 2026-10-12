`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.svh"

// Write-back: writes the register file and drives the OUT port.
module writeback_stage (
  input  logic                clk,
  input  logic                reset,          // active low, synchronous
  input  logic [`C_WIDTH-1:0] ctrl_in,
  input  logic [31:0]         result_in,
  input  logic [31:0]         mem_data_in,
  output logic                we,
  output logic [2:0]          waddr,
  output logic [31:0]         wdata,
  output logic [31:0]         out_port
);
  wire valid = ctrl_in[`C_VALID];

  assign we    = valid && ctrl_in[`C_REGWRITE];
  assign waddr = ctrl_in[`C_DEST];
  assign wdata = ctrl_in[`C_WBMEM] ? mem_data_in : result_in;

  always_ff @(posedge clk) begin
    if (!reset)                         out_port <= 32'h00000000;
    else if (valid && ctrl_in[`C_OUT])  out_port <= result_in;
  end
endmodule

`default_nettype wire
