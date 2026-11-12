/**
 * Preinstalled-software catalog for appliance builds. Each entry is one toggle
 * in the build dialog and expands to its apt packages. Packages are valid on
 * both Debian and Ubuntu cloud images; services auto-start via apt policy.
 */

export type SoftwareGroup = 'server' | 'tools';

export interface SoftwareEntry {
  id: string;
  name: string;
  group: SoftwareGroup;
  description: string;
  /** lucide-react icon name, resolved by the web UI. */
  icon: string;
  packages: string[];
}

export const softwareCatalog: SoftwareEntry[] = [
  // ---- server roles -------------------------------------------------------
  {
    id: 'ssh-server',
    name: 'SSH server',
    group: 'server',
    description: 'openssh-server — remote shell access into lab nodes.',
    icon: 'KeyRound',
    packages: ['openssh-server'],
  },
  {
    id: 'web-nginx',
    name: 'Web server (nginx)',
    group: 'server',
    description: 'nginx — lightweight HTTP server on port 80.',
    icon: 'Globe',
    packages: ['nginx'],
  },
  {
    id: 'web-apache',
    name: 'Web server (Apache)',
    group: 'server',
    description: 'apache2 — classic HTTP server on port 80.',
    icon: 'Globe',
    packages: ['apache2'],
  },
  {
    id: 'db-postgres',
    name: 'PostgreSQL',
    group: 'server',
    description: 'postgresql — SQL database listening on port 5432.',
    icon: 'Database',
    packages: ['postgresql'],
  },
  {
    id: 'db-mariadb',
    name: 'MariaDB',
    group: 'server',
    description: 'mariadb-server — MySQL-compatible SQL database on port 3306.',
    icon: 'Database',
    packages: ['mariadb-server'],
  },
  {
    id: 'dns-bind9',
    name: 'DNS server (BIND)',
    group: 'server',
    description: 'bind9 — authoritative/resolving DNS on port 53.',
    icon: 'Network',
    packages: ['bind9'],
  },
  {
    id: 'docker',
    name: 'Docker',
    group: 'server',
    description: 'docker.io — container runtime for running services in labs.',
    icon: 'Container',
    packages: ['docker.io'],
  },
  {
    id: 'reverse-proxy',
    name: 'HAProxy',
    group: 'server',
    description: 'haproxy — TCP/HTTP load balancer and reverse proxy.',
    icon: 'ArrowLeftRight',
    packages: ['haproxy'],
  },
  {
    id: 'firewall',
    name: 'Firewall (nftables)',
    group: 'server',
    description: 'nftables — packet filtering for router/gateway roles.',
    icon: 'Shield',
    packages: ['nftables'],
  },
  {
    id: 'vpn-wireguard',
    name: 'WireGuard VPN',
    group: 'server',
    description: 'wireguard — kernel VPN tunnels between lab sites.',
    icon: 'Lock',
    packages: ['wireguard'],
  },
  {
    id: 'monitoring',
    name: 'Node exporter',
    group: 'server',
    description: 'prometheus-node-exporter — metrics endpoint on port 9100.',
    icon: 'Activity',
    packages: ['prometheus-node-exporter'],
  },
  // ---- developer & network tools -----------------------------------------
  {
    id: 'git',
    name: 'Git',
    group: 'tools',
    description: 'git — version control.',
    icon: 'GitBranch',
    packages: ['git'],
  },
  {
    id: 'editors',
    name: 'Editors (vim, nano)',
    group: 'tools',
    description: 'vim + nano — terminal text editors.',
    icon: 'FileCode',
    packages: ['vim', 'nano'],
  },
  {
    id: 'http-tools',
    name: 'HTTP tools',
    group: 'tools',
    description: 'curl + wget — fetch and debug HTTP.',
    icon: 'Download',
    packages: ['curl', 'wget'],
  },
  {
    id: 'sysmonitor',
    name: 'System monitors',
    group: 'tools',
    description: 'htop + tmux — process view and persistent sessions.',
    icon: 'Gauge',
    packages: ['htop', 'tmux'],
  },
  {
    id: 'netdiag',
    name: 'Network tools',
    group: 'tools',
    description: 'tcpdump, iperf3, net-tools — capture, throughput, ifconfig/route.',
    icon: 'Cable',
    packages: ['tcpdump', 'iperf3', 'net-tools'],
  },
  {
    id: 'python',
    name: 'Python 3',
    group: 'tools',
    description: 'python3 — scripting and automation.',
    icon: 'Terminal',
    packages: ['python3'],
  },
  {
    id: 'toolchain',
    name: 'Build toolchain',
    group: 'tools',
    description: 'build-essential — gcc, make and headers.',
    icon: 'Hammer',
    packages: ['build-essential'],
  },
];
