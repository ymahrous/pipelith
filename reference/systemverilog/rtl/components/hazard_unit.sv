`timescale 1ns / 1ps
`default_nettype none

// Load-use hazard: the instruction in decode reads a register that the load
// in execute writes. Its data only exists after MEM, so decode waits a cycle
// and a bubble enters execute. Every other dependency is forwarded.
module hazard_unit (
  input  logic       id_usea,
  input  logic [2:0] id_areg,
  input  logic       id_useb,
  input  logic [2:0] id_breg,
  input  logic       id_ex_regwrite,
  input  logic       id_ex_wbmem,
  input  logic [2:0] id_ex_dest,
  output logic       stall
);
  assign stall = id_ex_regwrite && id_ex_wbmem &&
                 ((id_usea && id_areg == id_ex_dest) || (id_useb && id_breg == id_ex_dest));
endmodule

`default_nettype wire
