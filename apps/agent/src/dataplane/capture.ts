/** Capture and marker file paths inside a project directory. */

import path from 'node:path';
import type { AgentConfig } from '../config.ts';
import { captureDir, projectDir } from './project.ts';

export function capturePathFor(config: AgentConfig, projectId: string, linkId: string): string {
  return path.join(captureDir(config, projectId), `${linkId}.pcap`);
}

export function markerPcapPath(
  config: AgentConfig,
  projectId: string,
  linkId: string,
  markerName: string,
): string {
  const safe = markerName.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(captureDir(config, projectId), `${linkId}.${safe}.pcap`);
}

export function projectLogPath(config: AgentConfig, projectId: string, name: string): string {
  return path.join(projectDir(config, projectId), 'logs', name);
}
