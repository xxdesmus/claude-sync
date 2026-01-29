/**
 * @fileoverview Session utilities for claude-sync.
 * Provides functions for finding, reading, and writing session transcript files.
 * Note: This module provides lower-level access; prefer using the sessions handler
 * from the resources module for most operations.
 */

import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import { glob } from "glob";

/** Base Claude configuration directory. */
const CLAUDE_DIR = path.join(homedir(), ".claude");
/** Directory containing project-specific session files. */
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

/**
 * Represents a Claude Code session with its metadata.
 */
interface Session {
  id: string;
  path: string;
  project: string;
  modifiedAt: Date;
}

/**
 * Options for filtering sessions when searching.
 */
interface FindOptions {
  /** Only return sessions modified since the last sync operation. */
  modifiedSinceLastSync?: boolean;
}

/**
 * Finds all Claude Code session transcript files on this machine.
 * Searches the projects directory for JSONL files.
 * @param options - Optional filtering options.
 * @returns Array of session metadata including paths and modification times.
 */
export async function findSessions(options?: FindOptions): Promise<Session[]> {
  const pattern = path.join(PROJECTS_DIR, "**", "*.jsonl");
  const files = await glob(pattern);

  const sessions: Session[] = [];

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const id = path.basename(filePath, ".jsonl");

    // Extract project from path
    const relativePath = path.relative(PROJECTS_DIR, filePath);
    const project = path.dirname(relativePath);

    sessions.push({
      id,
      path: filePath,
      project,
      modifiedAt: stat.mtime,
    });
  }

  if (options?.modifiedSinceLastSync) {
    // TODO: Compare with last sync timestamp
    // For now, return all
    return sessions;
  }

  return sessions;
}

/**
 * Reads a session transcript file from disk.
 * @param sessionPath - Absolute path to the session JSONL file.
 * @returns The file contents as a string.
 */
export async function readSession(sessionPath: string): Promise<string> {
  return fs.readFile(sessionPath, "utf-8");
}

/**
 * Writes a session transcript file to disk.
 * Creates parent directories if they do not exist.
 * @param sessionPath - Absolute path where the session should be written.
 * @param content - The session content to write.
 * @returns A promise that resolves when the file is written.
 */
export async function writeSession(
  sessionPath: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, content, "utf-8");
}

/**
 * Computes the local file path where a session should be stored.
 * Creates the project directory if it does not exist.
 * @param sessionId - Unique identifier for the session.
 * @param project - Project name or path for organizing sessions.
 * @returns The absolute path where the session file should be stored.
 */
export async function getSessionPath(
  sessionId: string,
  project: string
): Promise<string> {
  const projectDir = path.join(PROJECTS_DIR, project);
  await fs.mkdir(projectDir, { recursive: true });
  return path.join(projectDir, `${sessionId}.jsonl`);
}
