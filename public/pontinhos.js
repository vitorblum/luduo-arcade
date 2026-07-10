"use strict";

(function exposePontinhosGame() {
  class PontinhosGame {
    static MAX_PHASE = 6;

    constructor({ phase = 1, width, height, top = 96, bottom = 24, rows = null, columns = null }) {
      this.phase = Math.max(1, Math.min(PontinhosGame.MAX_PHASE, Number(phase) || 1));
      this.maxPhase = PontinhosGame.MAX_PHASE;
      this.fixedRows = Number.isInteger(rows) ? rows : null;
      this.fixedColumns = Number.isInteger(columns) ? columns : null;
      this.currentPlayer = 1;
      this.scores = { 1: 0, 2: 0 };
      this.moves = 0;
      this.finished = false;
      this.resize(width, height, top, bottom);
      this.resetBoard();
    }

    resize(width, height, top = 96, bottom = 24) {
      const fixedRows = this.layout && this.horizontal ? this.layout.rows : this.fixedRows;
      const fixedColumns = this.layout && this.horizontal ? this.layout.columns : this.fixedColumns;
      this.width = Math.max(1, width);
      this.height = Math.max(1, height);
      this.topInset = top;
      this.bottomInset = bottom;
      this.layout = this.calculateLayout(fixedRows, fixedColumns);
    }

    calculateLayout(fixedRows = null, fixedColumns = null) {
      const margin = Math.max(36, Math.min(46, this.width * 0.09));
      const availableWidth = Math.max(180, this.width - margin * 2);
      const availableHeight = Math.max(260, this.height - this.topInset - this.bottomInset);
      const minSpacing = 46;
      const maxColumns = Math.max(3, Math.floor(availableWidth / minSpacing) + 1);
      const maxRows = Math.max(4, Math.floor(availableHeight / minSpacing) + 1);
      const progress = (this.phase - 1) / Math.max(1, PontinhosGame.MAX_PHASE - 1);
      const startColumns = Math.min(maxColumns, 4);
      const startRows = Math.min(maxRows, 5);
      const columns = fixedColumns || this.clamp(
        Math.round(startColumns + (maxColumns - startColumns) * progress),
        3,
        maxColumns
      );
      const rows = fixedRows || this.clamp(
        Math.round(startRows + (maxRows - startRows) * progress),
        4,
        maxRows
      );
      const spacing = Math.min(availableWidth / (columns - 1), availableHeight / (rows - 1));
      const boardWidth = (columns - 1) * spacing;
      const boardHeight = (rows - 1) * spacing;
      const left = (this.width - boardWidth) / 2;
      const top = this.topInset + (availableHeight - boardHeight) / 2;

      return {
        rows,
        columns,
        spacing,
        margin,
        left,
        top,
        right: left + boardWidth,
        bottom: top + boardHeight,
        pointTouchRadius: this.clamp(spacing * 0.36, 18, 32),
        touchRadius: this.clamp(spacing * 0.34, 15, 28)
      };
    }

    resetBoard() {
      const { rows, columns } = this.layout;
      this.horizontal = Array.from({ length: rows }, () => Array(columns - 1).fill(null));
      this.vertical = Array.from({ length: rows - 1 }, () => Array(columns).fill(null));
      this.boxes = Array.from({ length: rows - 1 }, () => Array(columns - 1).fill(0));
      this.totalMoves = rows * (columns - 1) + (rows - 1) * columns;
      this.totalBoxes = (rows - 1) * (columns - 1);
    }

    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    point(row, column) {
      return {
        x: this.layout.left + column * this.layout.spacing,
        y: this.layout.top + row * this.layout.spacing
      };
    }

    edgeExists(edge) {
      if (!edge) return false;
      return edge.type === "h"
        ? Boolean(this.horizontal[edge.row][edge.column])
        : Boolean(this.vertical[edge.row][edge.column]);
    }

    findPointAt(x, y) {
      const { rows, columns, pointTouchRadius } = this.layout;
      let best = null;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const point = this.point(row, column);
          const distance = Math.hypot(x - point.x, y - point.y);
          if (distance <= pointTouchRadius && (!best || distance < best.distance)) {
            best = { row, column, distance };
          }
        }
      }

      return best;
    }

    edgeFromPoints(start, end) {
      if (!start || !end) return null;

      const rowDelta = end.row - start.row;
      const columnDelta = end.column - start.column;

      if (Math.abs(rowDelta) + Math.abs(columnDelta) !== 1) return null;

      if (rowDelta === 0) {
        return {
          type: "h",
          row: start.row,
          column: Math.min(start.column, end.column)
        };
      }

      return {
        type: "v",
        row: Math.min(start.row, end.row),
        column: start.column
      };
    }

    findEdgeAt(x, y) {
      const { rows, columns, touchRadius } = this.layout;
      let best = null;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
          if (this.horizontal[row][column]) continue;
          const a = this.point(row, column);
          const b = this.point(row, column + 1);
          const outside = Math.max(a.x - x, 0, x - b.x);
          const distance = Math.abs(y - a.y) + outside * 0.75;
          if (distance <= touchRadius && (!best || distance < best.distance)) {
            best = { type: "h", row, column, distance };
          }
        }
      }

      for (let row = 0; row < rows - 1; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (this.vertical[row][column]) continue;
          const a = this.point(row, column);
          const b = this.point(row + 1, column);
          const outside = Math.max(a.y - y, 0, y - b.y);
          const distance = Math.abs(x - a.x) + outside * 0.75;
          if (distance <= touchRadius && (!best || distance < best.distance)) {
            best = { type: "v", row, column, distance };
          }
        }
      }

      return best;
    }

    playAt(x, y, now = Date.now()) {
      if (this.finished) return { played: false, reason: "finished" };

      const edge = this.findEdgeAt(x, y);
      return this.playEdge(edge, now);
    }

    playBetweenPoints(start, end, now = Date.now()) {
      if (this.finished) return { played: false, reason: "finished" };

      const edge = this.edgeFromPoints(start, end);
      return this.playEdge(edge, now);
    }

    playEdge(edge, now = Date.now()) {
      if (!edge || this.edgeExists(edge)) return { played: false, reason: "invalid" };

      const line = {
        owner: this.currentPlayer,
        start: now
      };

      if (edge.type === "h") {
        this.horizontal[edge.row][edge.column] = line;
      } else {
        this.vertical[edge.row][edge.column] = line;
      }

      this.moves += 1;
      const captured = this.captureBoxes(edge);

      if (captured === 0) {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
      } else {
        this.scores[this.currentPlayer] += captured;
      }

      if (this.moves >= this.totalMoves || this.scores[1] + this.scores[2] >= this.totalBoxes) {
        this.finished = true;
      }

      return {
        played: true,
        captured,
        edge,
        currentPlayer: this.currentPlayer,
        finished: this.finished
      };
    }

    captureBoxes(edge) {
      const candidates =
        edge.type === "h"
          ? [
              { row: edge.row - 1, column: edge.column },
              { row: edge.row, column: edge.column }
            ]
          : [
              { row: edge.row, column: edge.column - 1 },
              { row: edge.row, column: edge.column }
            ];

      let captured = 0;
      for (const box of candidates) {
        if (this.captureBoxIfComplete(box.row, box.column)) captured += 1;
      }

      return captured;
    }

    captureBoxIfComplete(row, column) {
      if (row < 0 || column < 0 || row >= this.layout.rows - 1 || column >= this.layout.columns - 1) {
        return false;
      }
      if (this.boxes[row][column]) return false;

      const complete =
        this.horizontal[row][column] &&
        this.horizontal[row + 1][column] &&
        this.vertical[row][column] &&
        this.vertical[row][column + 1];

      if (!complete) return false;

      this.boxes[row][column] = this.currentPlayer;
      return true;
    }

    result() {
      const winner = this.scores[1] === this.scores[2] ? 0 : this.scores[1] > this.scores[2] ? 1 : 2;
      return {
        winner,
        scores: { ...this.scores },
        phase: this.phase,
        totalBoxes: this.totalBoxes
      };
    }
  }

  window.PontinhosGame = PontinhosGame;
})();
