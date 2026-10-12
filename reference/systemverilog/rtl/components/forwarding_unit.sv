`timescale 1ns / 1ps
`default_nettype none

// Picks where the execute stage takes each operand from:
//   2'b00 the value read in decode, 2'b01 EX/MEM (result of the instruction
//   just ahead), 2'b10 MEM/WB (result about to be written back, including load data).
// A load in EX/MEM can't forward yet; the hazard unit stalls for that case.
module forwarding_unit (
  input  logic       ex_usea,
  input  logic [2:0] ex_areg,
  input  logic       ex_useb,
  input  logic [2:0] ex_breg,
  input  logic       ex_mem_regwrite,
  input  logic       ex_mem_wbmem,
  input  logic [2:0] ex_mem_dest,
  input  logic       mem_wb_regwrite,
  input  logic [2:0] mem_wb_dest,
  output logic [1:0] fwd_a,
  output logic [1:0] fwd_b
);
  always_comb begin
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
