`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// Write-back: writes the register file and drives the OUT port.
module writeback_stage (
  input  wire                clk,
  input  wire                reset,          // active low, synchronous
  input  wire [`C_WIDTH-1:0] ctrl_in,
  input  wire [31:0]         result_in,
  input  wire [31:0]         mem_data_in,
  output wire                we,
  output wire [2:0]          waddr,
  output wire [31:0]         wdata,
  output reg  [31:0]         out_port
);
  wire valid = ctrl_in[`C_VALID];

  assign we    = valid && ctrl_in[`C_REGWRITE];
  assign waddr = ctrl_in[`C_DEST];
  assign wdata = ctrl_in[`C_WBMEM] ? mem_data_in : result_in;

  always @(posedge clk) begin
    if (!reset)                         out_port <= 32'h00000000;
    else if (valid && ctrl_in[`C_OUT])  out_port <= result_in;
  end
endmodule

`default_nettype wire
