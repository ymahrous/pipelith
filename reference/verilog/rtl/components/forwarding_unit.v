`timescale 1ns / 1ps
`default_nettype none

// Picks where the execute stage takes each operand from:
//   2'b00 the value read in decode, 2'b01 EX/MEM (result of the instruction
//   just ahead), 2'b10 MEM/WB (result about to be written back, including load data).
// A load in EX/MEM can't forward yet; the hazard unit stalls for that case.
module forwarding_unit (
  input  wire       ex_usea,
  input  wire [2:0] ex_areg,
  input  wire       ex_useb,
  input  wire [2:0] ex_breg,
  input  wire       ex_mem_regwrite,
  input  wire       ex_mem_wbmem,
  input  wire [2:0] ex_mem_dest,
  input  wire       mem_wb_regwrite,
  input  wire [2:0] mem_wb_dest,
  output reg  [1:0] fwd_a,
  output reg  [1:0] fwd_b
);
  always @* begin
    fwd_a = 2'b00;
    if (ex_usea) begin
      if (ex_mem_regwrite && !ex_mem_wbmem && ex_mem_dest == ex_areg) fwd_a = 2'b01;
      else if (mem_wb_regwrite && mem_wb_dest == ex_areg) fwd_a = 2'b10;
    end
    fwd_b = 2'b00;
    if (ex_useb) begin
      if (ex_mem_regwrite && !ex_mem_wbmem && ex_mem_dest == ex_breg) fwd_b = 2'b01;
      else if (mem_wb_regwrite && mem_wb_dest == ex_breg) fwd_b = 2'b10;
    end
  end
endmodule

`default_nettype wire
