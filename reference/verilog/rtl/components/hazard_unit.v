`timescale 1ns / 1ps
`default_nettype none

// Load-use hazard: the instruction in decode reads a register that the load
// in execute writes. Its data only exists after MEM, so decode waits a cycle
// and a bubble enters execute. Every other dependency is forwarded.
module hazard_unit (
  input  wire       id_usea,
  input  wire [2:0] id_areg,
  input  wire       id_useb,
  input  wire [2:0] id_breg,
  input  wire       id_ex_regwrite,
  input  wire       id_ex_wbmem,
  input  wire [2:0] id_ex_dest,
  output wire       stall
);
  assign stall = id_ex_regwrite && id_ex_wbmem &&
                 ((id_usea && id_areg == id_ex_dest) || (id_useb && id_breg == id_ex_dest));
endmodule

`default_nettype wire
