// isa_defs.vh — opcodes and the micro-op control word shared by every stage.
//
// Instruction word: [31:27] opcode | [26:24] Rsrc1 | [23:21] Rsrc2 | [20:18] Rdst | [17:16] index
// Two-word instructions carry a 32-bit immediate (or offset, or jump target) in the next word.

`ifndef ISA_DEFS_SVH
`define ISA_DEFS_SVH

// ---------- opcodes ----------
`define OP_NOP   5'b00000
`define OP_HLT   5'b00001
`define OP_SETC  5'b00010
`define OP_NOT   5'b00011
`define OP_INC   5'b00100
`define OP_OUT   5'b00101
`define OP_IN    5'b00110
`define OP_MOV   5'b01000
`define OP_SWAP  5'b01001
`define OP_ADD   5'b01010
`define OP_SUB   5'b01011
`define OP_AND   5'b01100
`define OP_PUSH  5'b10000
`define OP_POP   5'b10001
`define OP_LDM   5'b10100
`define OP_LDD   5'b10101
`define OP_STD   5'b10110
`define OP_IADD  5'b10111
`define OP_JZ    5'b11000
`define OP_JN    5'b11001
`define OP_JC    5'b11010
`define OP_JMP   5'b11011
`define OP_CALL  5'b11100
`define OP_RET   5'b11101
`define OP_INT   5'b11110
`define OP_RTI   5'b11111

// ---------- ALU operations ----------
`define ALU_PASS_A   4'd0
`define ALU_NOT      4'd1
`define ALU_INC      4'd2
`define ALU_ADD      4'd3
`define ALU_SUB      4'd4
`define ALU_AND      4'd5
`define ALU_ADD_IMM  4'd6
`define ALU_PASS_IMM 4'd7
`define ALU_PASS_IN  4'd8
`define ALU_SWAP     4'd9
`define ALU_NONE     4'd10

// ---------- memory operations (MEM stage) ----------
`define MEM_NONE   3'd0
`define MEM_LOAD   3'd1   // read  M[ALU result]
`define MEM_STORE  3'd2   // write M[ALU result] <- data
`define MEM_PUSH   3'd3   // write M[SP] <- data, then SP <- SP - 1
`define MEM_POP    3'd4   // SP <- SP + 1, then read M[SP]
`define MEM_VECTOR 3'd5   // read M[immediate] and jump there

// Where a popped word goes
`define POP_REG   2'd0
`define POP_PC    2'd1
`define POP_FLAGS 2'd2

// What a push writes
`define PUSH_A     2'd0
`define PUSH_CONST 2'd1
`define PUSH_FLAGS 2'd2

// Which value fills a micro-op's immediate field
`define IMM_WORD   3'd0   // the instruction's second word
`define IMM_PC1    3'd1   // address of the next instruction (INT return address)
`define IMM_PC2    3'd2   // address after a two-word instruction (CALL return address)
`define IMM_PC     3'd3   // this instruction's address (interrupt return address)
`define IMM_INTVEC 3'd4   // 2 + index (INT vector)
`define IMM_EXTVEC 3'd5   // 1 (external interrupt vector)

// Conditional branches
`define BR_NONE 2'd0
`define BR_JZ   2'd1
`define BR_JN   2'd2
`define BR_JC   2'd3

// Flag bits in the condition code register
`define FLAG_Z 0
`define FLAG_N 1
`define FLAG_C 2

// ---------- micro-op control word ----------
// One per pipeline slot, carried ID -> EX -> MEM -> WB. All zero is a bubble.
`define C_VALID    0
`define C_REGWRITE 1
`define C_DEST     4:2
`define C_WBMEM    5      // the written-back value comes from memory
`define C_FLAGS_ZN 6
`define C_FLAGS_C  7
`define C_SETC     8
`define C_BRANCH   10:9
`define C_ALU      14:11
`define C_MEMOP    17:15
`define C_POPDST   19:18
`define C_OUT      20
`define C_USEA     21
`define C_AREG     24:22
`define C_USEB     25
`define C_BREG     28:26
`define C_PUSHSRC  30:29
`define C_WIDTH    31

`endif
