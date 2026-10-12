`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.svh"

// 5-stage pipelined RISC processor: IF -> ID -> EX -> MEM -> WB.
//
//  - Full forwarding into EX from EX/MEM and MEM/WB; the register file writes
//    before it reads, so write-back and decode can share a cycle.
//  - A load followed by an instruction that uses its result stalls one cycle.
//  - Conditional branches resolve in EX (one wrong-path fetch is flushed);
//    JMP and CALL resolve in decode as their target word is fetched.
//  - One memory for instructions and data: a load or store in MEM delays fetch.
//  - Reset is active low and synchronous; while it is held, PC loads M[0].
//
// Implements the same instruction set as Pipelith's reference model; the
// architectural state (pc_out, r0..r7, sp_value, ccr) is visible at this level.
module processor #(
  parameter MEM_FILE = "program.mem"
) (
  input  logic        clk,
  input  logic        reset,
  input  logic        intr,       // external interrupt request
  input  logic [31:0] in_port,
  output logic [31:0] out_port
);
  // ---------- architectural state ----------
  logic [31:0] pc_out;
  logic [31:0] sp_value;
  logic [2:0]  ccr;
  logic [31:0] r0, r1, r2, r3, r4, r5, r6, r7;

  // ---------- pipeline wiring ----------
  logic        if_valid, if_flush;
  logic        id_valid;
  logic [31:0] id_instr, id_pc, id_in_val;
  logic [`C_WIDTH-1:0] id_uop, id_ctrl;
  logic [31:0] id_pc_next, id_a, id_b, id_imm, id_in_val_next;
  logic        id_hold, id_consume_imm, id_jump, id_fetch_stop;
  logic [31:0] id_jump_target;
  logic [`C_WIDTH-1:0] ex_ctrl;
  logic [31:0] ex_pc, ex_a, ex_b, ex_imm, ex_in_val;
  logic [31:0] ex_result, ex_data;
  logic        ex_jump;
  logic [31:0] ex_jump_target;
  logic [1:0]  fwd_a, fwd_b;
  logic [`C_WIDTH-1:0] mem_ctrl;
  logic [31:0] mem_pc, mem_result, mem_data, mem_imm;
  logic        mem_jump;
  logic [31:0] mem_jump_target;
  logic        mem_flags_we;
  logic [2:0]  mem_flags;
  logic [`C_WIDTH-1:0] wb_ctrl;
  logic [31:0] wb_pc, wb_result, wb_mem_data;
  logic        wb_we;
  logic [2:0]  wb_waddr;
  logic [31:0] wb_wdata;
  logic [2:0]  rf_ra, rf_rb;
  logic [31:0] rf_a, rf_b;
  logic        hazard_stall;

  // ---------- memory (one port, shared by fetch and MEM) ----------
  logic        mem_access;
  logic [31:0] mem_stage_addr;
  logic        mem_we;
  logic [31:0] mem_wdata;
  logic [31:0] mem_rdata;
  wire [31:0] mem_addr   = !reset ? 32'd0 : (mem_access ? mem_stage_addr : pc_out);
  wire        fetch_free = reset && !mem_access;

  memory #(.MEM_FILE(MEM_FILE)) u_memory (
    .clk(clk), .addr(mem_addr), .we(mem_we), .wdata(mem_wdata), .rdata(mem_rdata)
  );

  // ---------- external interrupt ----------
  logic  irq_pending;
  logic irq_taken;

  always_ff @(posedge clk) begin
    if (!reset)         irq_pending <= 1'b0;
    else if (intr)      irq_pending <= 1'b1;
    else if (irq_taken) irq_pending <= 1'b0;
  end

  // ---------- IF ----------
  fetch_stage u_fetch (
    .clk(clk), .reset(reset),
    .fetch_word(mem_rdata), .fetch_free(fetch_free),
    .hold(id_hold), .fetch_stop(id_fetch_stop), .consume_imm(id_consume_imm),
    .id_jump(id_jump), .id_target(id_jump_target),
    .ex_jump(ex_jump), .ex_target(ex_jump_target),
    .mem_jump(mem_jump), .mem_target(mem_jump_target),
    .pc(pc_out), .fetch_valid(if_valid), .flush(if_flush)
  );

  if_id_register u_if_id (
    .clk(clk), .reset(reset), .stall(id_hold), .flush(if_flush),
    .valid_in(if_valid), .instr_in(mem_rdata), .pc_in(pc_out), .in_val_in(in_port),
    .valid_out(id_valid), .instr_out(id_instr), .pc_out(id_pc), .in_val_out(id_in_val)
  );

  // ---------- ID ----------
  decode_stage u_decode (
    .clk(clk), .reset(reset),
    .valid_in(id_valid), .instr_in(id_instr), .pc_in(id_pc), .in_val_in(id_in_val),
    .fetch_word(mem_rdata), .fetch_free(fetch_free),
    .flush(ex_jump || mem_jump), .mem_jump(mem_jump),
    .irq_pending(irq_pending), .hazard_stall(hazard_stall),
    .rdata_a(rf_a), .rdata_b(rf_b), .ra(rf_ra), .rb(rf_rb),
    .uop(id_uop), .ctrl_out(id_ctrl), .pc_out(id_pc_next),
    .a_out(id_a), .b_out(id_b), .imm_out(id_imm), .in_val_out(id_in_val_next),
    .hold(id_hold), .consume_imm(id_consume_imm),
    .jump(id_jump), .jump_target(id_jump_target),
    .fetch_stop(id_fetch_stop), .irq_taken(irq_taken)
  );

  hazard_unit u_hazard (
    .id_usea(id_uop[`C_USEA]), .id_areg(id_uop[`C_AREG]),
    .id_useb(id_uop[`C_USEB]), .id_breg(id_uop[`C_BREG]),
    .id_ex_regwrite(ex_ctrl[`C_REGWRITE]), .id_ex_wbmem(ex_ctrl[`C_WBMEM]), .id_ex_dest(ex_ctrl[`C_DEST]),
    .stall(hazard_stall)
  );

  register_file u_regfile (
    .clk(clk), .reset(reset),
    .ra(rf_ra), .rb(rf_rb), .rdata_a(rf_a), .rdata_b(rf_b),
    .we(wb_we), .waddr(wb_waddr), .wdata(wb_wdata),
    .r0(r0), .r1(r1), .r2(r2), .r3(r3), .r4(r4), .r5(r5), .r6(r6), .r7(r7)
  );

  id_ex_register u_id_ex (
    .clk(clk), .reset(reset), .stall(1'b0), .flush(ex_jump || mem_jump),
    .ctrl_in(id_ctrl), .pc_in(id_pc_next), .a_in(id_a), .b_in(id_b), .imm_in(id_imm), .in_val_in(id_in_val_next),
    .ctrl_out(ex_ctrl), .pc_out(ex_pc), .a_out(ex_a), .b_out(ex_b), .imm_out(ex_imm), .in_val_out(ex_in_val)
  );

  // ---------- EX ----------
  forwarding_unit u_forward (
    .ex_usea(ex_ctrl[`C_USEA]), .ex_areg(ex_ctrl[`C_AREG]),
    .ex_useb(ex_ctrl[`C_USEB]), .ex_breg(ex_ctrl[`C_BREG]),
    .ex_mem_regwrite(mem_ctrl[`C_REGWRITE]), .ex_mem_wbmem(mem_ctrl[`C_WBMEM]), .ex_mem_dest(mem_ctrl[`C_DEST]),
    .mem_wb_regwrite(wb_ctrl[`C_REGWRITE]), .mem_wb_dest(wb_ctrl[`C_DEST]),
    .fwd_a(fwd_a), .fwd_b(fwd_b)
  );

  execute_stage u_execute (
    .clk(clk), .reset(reset),
    .ctrl_in(ex_ctrl), .a_in(ex_a), .b_in(ex_b), .imm_in(ex_imm), .in_val_in(ex_in_val),
    .fwd_a(fwd_a), .fwd_b(fwd_b),
    .ex_mem_result(mem_result), .ex_mem_data(mem_data), .mem_wb_result(wb_wdata),
    .flags_we(mem_flags_we), .flags_in(mem_flags),
    .result_out(ex_result), .data_out(ex_data), .ccr(ccr),
    .jump(ex_jump), .jump_target(ex_jump_target)
  );

  ex_mem_register u_ex_mem (
    .clk(clk), .reset(reset), .stall(1'b0), .flush(1'b0),
    .ctrl_in(ex_ctrl), .pc_in(ex_pc), .result_in(ex_result), .data_in(ex_data), .imm_in(ex_imm),
    .ctrl_out(mem_ctrl), .pc_out(mem_pc), .result_out(mem_result), .data_out(mem_data), .imm_out(mem_imm)
  );

  // ---------- MEM ----------
  memory_stage u_mem (
    .clk(clk), .reset(reset),
    .ctrl_in(mem_ctrl), .result_in(mem_result), .data_in(mem_data), .imm_in(mem_imm), .rdata(mem_rdata),
    .access(mem_access), .addr(mem_stage_addr), .we(mem_we), .wdata(mem_wdata),
    .jump(mem_jump), .jump_target(mem_jump_target),
    .flags_we(mem_flags_we), .flags_out(mem_flags), .sp(sp_value)
  );

  mem_wb_register u_mem_wb (
    .clk(clk), .reset(reset), .stall(1'b0), .flush(1'b0),
    .ctrl_in(mem_ctrl), .pc_in(mem_pc), .result_in(mem_result), .mem_data_in(mem_rdata),
    .ctrl_out(wb_ctrl), .pc_out(wb_pc), .result_out(wb_result), .mem_data_out(wb_mem_data)
  );

  // ---------- WB ----------
  writeback_stage u_wb (
    .clk(clk), .reset(reset),
    .ctrl_in(wb_ctrl), .result_in(wb_result), .mem_data_in(wb_mem_data),
    .we(wb_we), .waddr(wb_waddr), .wdata(wb_wdata), .out_port(out_port)
  );
endmodule

`default_nettype wire
