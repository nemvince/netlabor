/**
 * Preinstalled-software catalog for appliance builds. Each entry is one toggle
 * in the build dialog; packages resolve per OS family because Debian, Rocky,
 * and Alpine name the same role differently.
 *
 * Entries without a mapping for a family are hidden for that base image.
 */

import type { OsFamily } from '@netlabor/contract';

export type SoftwareGroup = 'gui' | 'office' | 'sysadmin' | 'network' | 'server' | 'tools';

export interface SoftwareEntry {
  id: string;
  name: string;
  group: SoftwareGroup;
  description: string;
  /** lucide-react icon name, resolved by the web UI. */
  icon: string;
  /** Package list per OS family; omitting a family hides the entry there. */
  packages: Partial<Record<OsFamily, string[]>>;
}

/** Debian and Ubuntu share package names. */
function apt(...packages: string[]): Partial<Record<OsFamily, string[]>> {
  return { debian: packages, ubuntu: packages };
}

function withFamilies(
  base: Partial<Record<OsFamily, string[]>>,
  extra: Partial<Record<OsFamily, string[]>>,
): Partial<Record<OsFamily, string[]>> {
  return { ...base, ...extra };
}

export const softwareCatalog: SoftwareEntry[] = [
  // ---- office clients ------------------------------------------------------
  {
    id: 'libreoffice',
    name: 'LibreOffice',
    group: 'office',
    description: 'Writer, Calc, Impress — the full office suite.',
    icon: 'FileText',
    packages: withFamilies(apt('libreoffice'), {
      rocky: ['libreoffice'],
      alpine: ['libreoffice'],
    }),
  },
  // ---- GUI applications (shown only once a desktop is selected) -----------
  {
    id: 'thunderbird',
    name: 'Thunderbird',
    group: 'gui',
    description: 'Mail client for IMAP/SMTP lab services.',
    icon: 'Mail',
    packages: withFamilies(apt('thunderbird'), {
      rocky: ['thunderbird'],
      alpine: ['thunderbird'],
    }),
  },
  {
    id: 'rdp-client',
    name: 'Remote desktop client',
    group: 'gui',
    description: 'Remmina — RDP/VNC client for jumping into other nodes.',
    icon: 'Monitor',
    packages: withFamilies(apt('remmina'), { rocky: ['remmina'], alpine: ['remmina'] }),
  },
  {
    id: 'printing',
    name: 'Printing (CUPS)',
    group: 'office',
    description: 'CUPS print server/client for office print labs.',
    icon: 'Printer',
    packages: withFamilies(apt('cups'), { rocky: ['cups'], alpine: ['cups'] }),
  },
  {
    id: 'smb-client',
    name: 'SMB client',
    group: 'office',
    description: 'smbclient — mount and test Windows/Samba shares.',
    icon: 'FolderTree',
    packages: withFamilies(apt('smbclient'), {
      rocky: ['samba-client'],
      alpine: ['samba-client'],
    }),
  },
  {
    id: 'archives',
    name: 'Archives',
    group: 'office',
    description: 'zip, unzip, p7zip — archive tools for file-share labs.',
    icon: 'Archive',
    packages: withFamilies(apt('zip', 'unzip', 'p7zip-full'), {
      rocky: ['zip', 'unzip', 'p7zip'],
      alpine: ['zip', 'unzip', 'p7zip'],
    }),
  },
  {
    id: 'fonts',
    name: 'Desktop fonts',
    group: 'gui',
    description: 'DejaVu/Liberation fonts so desktops render legibly.',
    icon: 'Type',
    packages: withFamilies(apt('fonts-dejavu-core', 'fonts-liberation'), {
      rocky: ['dejavu-sans-fonts', 'liberation-fonts'],
      alpine: ['font-dejavu', 'font-liberation'],
    }),
  },
  {
    id: 'image-editor',
    name: 'Image editor',
    group: 'gui',
    description: 'GIMP and ImageMagick for diagram/screenshot work.',
    icon: 'Image',
    packages: withFamilies(apt('gimp', 'imagemagick'), {
      rocky: ['gimp', 'ImageMagick'],
      alpine: ['gimp', 'imagemagick'],
    }),
  },
  {
    id: 'media-player',
    name: 'Media player',
    group: 'gui',
    description: 'VLC — play test media and multicast streams.',
    icon: 'Music',
    packages: withFamilies(apt('vlc'), { alpine: ['vlc'] }),
  },

  // ---- system administration ----------------------------------------------
  {
    id: 'ansible',
    name: 'Ansible',
    group: 'sysadmin',
    description: 'Configuration management and ad-hoc remote automation.',
    icon: 'Wrench',
    packages: withFamilies(apt('ansible'), {
      rocky: ['ansible-core'],
      alpine: ['ansible'],
    }),
  },
  {
    id: 'rsync',
    name: 'rsync',
    group: 'sysadmin',
    description: 'File sync and backup transfers.',
    icon: 'RefreshCw',
    packages: withFamilies(apt('rsync'), { rocky: ['rsync'], alpine: ['rsync'] }),
  },
  {
    id: 'jq',
    name: 'jq',
    group: 'sysadmin',
    description: 'Command-line JSON processor.',
    icon: 'FileCode',
    packages: withFamilies(apt('jq'), { rocky: ['jq'], alpine: ['jq'] }),
  },
  {
    id: 'tree',
    name: 'tree / ncdu',
    group: 'sysadmin',
    description: 'Directory trees and disk-usage browsing.',
    icon: 'FolderTree',
    packages: withFamilies(apt('tree', 'ncdu'), { rocky: ['tree'], alpine: ['tree', 'ncdu'] }),
  },
  {
    id: 'lsof',
    name: 'lsof',
    group: 'sysadmin',
    description: 'List open files and sockets.',
    icon: 'ScanLine',
    packages: withFamilies(apt('lsof'), { rocky: ['lsof'], alpine: ['lsof'] }),
  },
  {
    id: 'strace',
    name: 'strace',
    group: 'sysadmin',
    description: 'Trace system calls and signals.',
    icon: 'Bug',
    packages: withFamilies(apt('strace'), { rocky: ['strace'], alpine: ['strace'] }),
  },
  {
    id: 'iotop',
    name: 'iotop / sysstat',
    group: 'sysadmin',
    description: 'Disk I/O monitors and sar/iostat history.',
    icon: 'Activity',
    packages: withFamilies(apt('iotop', 'sysstat'), {
      rocky: ['iotop', 'sysstat'],
      alpine: ['iotop', 'sysstat'],
    }),
  },
  {
    id: 'screen',
    name: 'screen',
    group: 'sysadmin',
    description: 'Detachable terminal sessions (alongside tmux).',
    icon: 'Monitor',
    packages: withFamilies(apt('screen'), { rocky: ['screen'], alpine: ['screen'] }),
  },
  {
    id: 'fail2ban',
    name: 'Fail2ban',
    group: 'sysadmin',
    description: 'Ban brute-force SSH/web clients.',
    icon: 'ShieldCheck',
    packages: withFamilies(apt('fail2ban'), {
      rocky: ['fail2ban'],
      alpine: ['fail2ban'],
    }),
  },
  {
    id: 'cron',
    name: 'Cron',
    group: 'sysadmin',
    description: 'Scheduled jobs (cronie on Rocky, dcron on Alpine).',
    icon: 'Timer',
    packages: withFamilies(apt('cron'), { rocky: ['cronie'], alpine: ['dcron'] }),
  },
  {
    id: 'logrotate',
    name: 'logrotate',
    group: 'sysadmin',
    description: 'Rotate and compress service logs.',
    icon: 'FileText',
    packages: withFamilies(apt('logrotate'), { rocky: ['logrotate'], alpine: ['logrotate'] }),
  },
  {
    id: 'lvm',
    name: 'LVM / parted',
    group: 'sysadmin',
    description: 'Volume management and partition editing.',
    icon: 'HardDrive',
    packages: withFamilies(apt('lvm2', 'parted'), {
      rocky: ['lvm2', 'parted'],
      alpine: ['lvm2', 'parted'],
    }),
  },

  // ---- network tooling -----------------------------------------------------
  {
    id: 'netdiag',
    name: 'Network diagnostics',
    group: 'network',
    description: 'tcpdump, iperf3, net-tools — capture, throughput, ifconfig/route.',
    icon: 'Cable',
    packages: withFamilies(apt('tcpdump', 'iperf3', 'net-tools'), {
      rocky: ['tcpdump', 'iperf3', 'net-tools'],
      alpine: ['tcpdump', 'iperf3', 'net-tools'],
    }),
  },
  {
    id: 'nmap',
    name: 'nmap',
    group: 'network',
    description: 'Port and service scanning.',
    icon: 'ScanLine',
    packages: withFamilies(apt('nmap'), { rocky: ['nmap'], alpine: ['nmap'] }),
  },
  {
    id: 'tshark',
    name: 'tshark',
    group: 'network',
    description: 'Wireshark CLI dissector for scripted captures.',
    icon: 'Activity',
    packages: withFamilies(apt('tshark'), { rocky: ['wireshark-cli'], alpine: ['tshark'] }),
  },
  {
    id: 'mtr',
    name: 'mtr',
    group: 'network',
    description: 'Combined ping/traceroute with live loss stats.',
    icon: 'Route',
    packages: withFamilies(apt('mtr-tiny'), { rocky: ['mtr'], alpine: ['mtr'] }),
  },
  {
    id: 'dns-tools',
    name: 'DNS tools',
    group: 'network',
    description: 'dig/nslookup/host and DNS debugging utilities.',
    icon: 'Network',
    packages: withFamilies(apt('dnsutils'), {
      rocky: ['bind-utils'],
      alpine: ['bind-tools'],
    }),
  },
  {
    id: 'traceroute',
    name: 'traceroute / whois',
    group: 'network',
    description: 'Path discovery and registry lookups.',
    icon: 'Route',
    packages: withFamilies(apt('traceroute', 'whois'), {
      rocky: ['traceroute', 'whois'],
      alpine: ['traceroute', 'whois'],
    }),
  },
  {
    id: 'socat',
    name: 'socat',
    group: 'network',
    description: 'Relay and pivot between sockets, ports, and files.',
    icon: 'Cable',
    packages: withFamilies(apt('socat'), { rocky: ['socat'], alpine: ['socat'] }),
  },
  {
    id: 'netcat',
    name: 'netcat',
    group: 'network',
    description: 'TCP/UDP Swiss army knife for reachability tests.',
    icon: 'Cable',
    packages: withFamilies(apt('netcat-openbsd'), {
      rocky: ['nmap-ncat'],
      alpine: ['netcat-openbsd'],
    }),
  },
  {
    id: 'iftop',
    name: 'iftop',
    group: 'network',
    description: 'Live per-connection bandwidth monitor.',
    icon: 'Activity',
    packages: withFamilies(apt('iftop'), { rocky: ['iftop'], alpine: ['iftop'] }),
  },
  {
    id: 'ethtool',
    name: 'ethtool',
    group: 'network',
    description: 'NIC link speed, offload, and ring settings.',
    icon: 'Wrench',
    packages: withFamilies(apt('ethtool'), { rocky: ['ethtool'], alpine: ['ethtool'] }),
  },
  {
    id: 'conntrack',
    name: 'conntrack tools',
    group: 'network',
    description: 'Inspect and clear netfilter connection tracking.',
    icon: 'Network',
    packages: apt('conntrack'),
  },
  {
    id: 'tcpreplay',
    name: 'tcpreplay',
    group: 'network',
    description: 'Replay captured pcap traffic across links.',
    icon: 'Play',
    packages: apt('tcpreplay'),
  },

  // ---- server roles --------------------------------------------------------
  {
    id: 'ssh-server',
    name: 'SSH server',
    group: 'server',
    description: 'openssh-server — remote shell access into lab nodes.',
    icon: 'KeyRound',
    packages: withFamilies(apt('openssh-server'), {
      rocky: ['openssh-server'],
      alpine: ['openssh'],
    }),
  },
  {
    id: 'web-nginx',
    name: 'Web server (nginx)',
    group: 'server',
    description: 'nginx — lightweight HTTP server on port 80.',
    icon: 'Globe',
    packages: withFamilies(apt('nginx'), { rocky: ['nginx'], alpine: ['nginx'] }),
  },
  {
    id: 'web-apache',
    name: 'Web server (Apache)',
    group: 'server',
    description: 'apache2/httpd — classic HTTP server on port 80.',
    icon: 'Globe',
    packages: withFamilies(apt('apache2'), { rocky: ['httpd'], alpine: ['apache2'] }),
  },
  {
    id: 'db-postgres',
    name: 'PostgreSQL',
    group: 'server',
    description: 'postgresql — SQL database listening on port 5432.',
    icon: 'Database',
    packages: withFamilies(apt('postgresql'), {
      rocky: ['postgresql-server'],
      alpine: ['postgresql'],
    }),
  },
  {
    id: 'db-mariadb',
    name: 'MariaDB',
    group: 'server',
    description: 'mariadb-server — MySQL-compatible SQL database on port 3306.',
    icon: 'Database',
    packages: withFamilies(apt('mariadb-server'), {
      rocky: ['mariadb-server'],
      alpine: ['mariadb'],
    }),
  },
  {
    id: 'db-redis',
    name: 'Redis',
    group: 'server',
    description: 'redis-server — in-memory cache and message broker.',
    icon: 'Database',
    packages: withFamilies(apt('redis-server'), { rocky: ['redis'], alpine: ['redis'] }),
  },
  {
    id: 'dns-bind9',
    name: 'DNS server (BIND)',
    group: 'server',
    description: 'bind9 — authoritative/resolving DNS on port 53.',
    icon: 'Network',
    packages: withFamilies(apt('bind9'), { rocky: ['bind'], alpine: ['bind'] }),
  },
  {
    id: 'dns-unbound',
    name: 'DNS resolver (Unbound)',
    group: 'server',
    description: 'unbound — validating recursive resolver.',
    icon: 'Network',
    packages: withFamilies(apt('unbound'), { rocky: ['unbound'], alpine: ['unbound'] }),
  },
  {
    id: 'dns-dnsmasq',
    name: 'dnsmasq',
    group: 'server',
    description: 'DNS forwarder plus DHCP/TFTP for small labs.',
    icon: 'Network',
    packages: withFamilies(apt('dnsmasq'), { rocky: ['dnsmasq'], alpine: ['dnsmasq'] }),
  },
  {
    id: 'dhcp-server',
    name: 'DHCP server',
    group: 'server',
    description: 'DHCP server for client and office network labs.',
    icon: 'Network',
    packages: withFamilies(apt('isc-dhcp-server'), {
      rocky: ['dhcp-server'],
      alpine: ['dhcp'],
    }),
  },
  {
    id: 'ntp',
    name: 'NTP server',
    group: 'server',
    description: 'chrony — authoritative time for network labs.',
    icon: 'Timer',
    packages: withFamilies(apt('chrony'), { rocky: ['chrony'], alpine: ['chrony'] }),
  },
  {
    id: 'docker',
    name: 'Containers',
    group: 'server',
    description: 'Docker (Podman on Rocky) — container runtime.',
    icon: 'Container',
    packages: withFamilies(apt('docker.io'), { rocky: ['podman'], alpine: ['docker'] }),
  },
  {
    id: 'reverse-proxy',
    name: 'HAProxy',
    group: 'server',
    description: 'haproxy — TCP/HTTP load balancer and reverse proxy.',
    icon: 'ArrowLeftRight',
    packages: withFamilies(apt('haproxy'), { rocky: ['haproxy'], alpine: ['haproxy'] }),
  },
  {
    id: 'firewall',
    name: 'Firewall (nftables)',
    group: 'server',
    description: 'nftables — packet filtering for router/gateway roles.',
    icon: 'Shield',
    packages: withFamilies(apt('nftables'), { rocky: ['nftables'], alpine: ['nftables'] }),
  },
  {
    id: 'iptables',
    name: 'iptables',
    group: 'server',
    description: 'Legacy netfilter tooling for older lab scenarios.',
    icon: 'Shield',
    packages: withFamilies(apt('iptables'), { rocky: ['iptables'], alpine: ['iptables'] }),
  },
  {
    id: 'vpn-wireguard',
    name: 'WireGuard VPN',
    group: 'server',
    description: 'wireguard — kernel VPN tunnels between lab sites.',
    icon: 'Lock',
    packages: withFamilies(apt('wireguard'), {
      rocky: ['wireguard-tools'],
      alpine: ['wireguard-tools'],
    }),
  },
  {
    id: 'vpn-openvpn',
    name: 'OpenVPN',
    group: 'server',
    description: 'openvpn — TLS VPN server for client VPN labs.',
    icon: 'Lock',
    packages: withFamilies(apt('openvpn'), { rocky: ['openvpn'], alpine: ['openvpn'] }),
  },
  {
    id: 'vpn-strongswan',
    name: 'strongSwan IPsec',
    group: 'server',
    description: 'strongswan — site-to-site IPsec/IKEv2.',
    icon: 'Lock',
    packages: withFamilies(apt('strongswan'), {
      rocky: ['strongswan'],
      alpine: ['strongswan'],
    }),
  },
  {
    id: 'radius',
    name: 'FreeRADIUS',
    group: 'server',
    description: 'RADIUS AAA for 802.1X and VPN labs.',
    icon: 'KeyRound',
    packages: withFamilies(apt('freeradius'), {
      rocky: ['freeradius'],
      alpine: ['freeradius'],
    }),
  },
  {
    id: 'snmp',
    name: 'SNMP daemon',
    group: 'server',
    description: 'snmpd — pollable metrics and traps.',
    icon: 'Activity',
    packages: withFamilies(apt('snmpd'), { rocky: ['net-snmp'], alpine: ['net-snmp'] }),
  },
  {
    id: 'monitoring-node-exporter',
    name: 'Node exporter',
    group: 'server',
    description: 'prometheus-node-exporter — metrics endpoint on port 9100.',
    icon: 'Activity',
    packages: withFamilies(apt('prometheus-node-exporter'), {
      alpine: ['prometheus-node-exporter'],
    }),
  },
  {
    id: 'monitoring-zabbix-agent',
    name: 'Zabbix agent',
    group: 'server',
    description: 'Zabbix agent for host monitoring.',
    icon: 'Activity',
    packages: withFamilies(apt('zabbix-agent'), {
      rocky: ['zabbix-agent'],
      alpine: ['zabbix-agent'],
    }),
  },
  {
    id: 'monitoring-zabbix-server',
    name: 'Zabbix server',
    group: 'server',
    description: 'Zabbix server and PHP frontend.',
    icon: 'Activity',
    packages: withFamilies(apt('zabbix-server-pgsql', 'zabbix-frontend-php'), {
      rocky: ['zabbix-server-pgsql', 'zabbix-web-pgsql'],
    }),
  },
  {
    id: 'monitoring-prometheus',
    name: 'Prometheus',
    group: 'server',
    description: 'Prometheus server for metrics scraping.',
    icon: 'Activity',
    packages: apt('prometheus'),
  },
  {
    id: 'monitoring-grafana',
    name: 'Grafana',
    group: 'server',
    description: 'Grafana dashboards for lab metrics.',
    icon: 'Activity',
    packages: withFamilies(apt('grafana'), { alpine: ['grafana'] }),
  },
  {
    id: 'logging-rsyslog',
    name: 'Central logging',
    group: 'server',
    description: 'rsyslog — collect syslog from lab devices.',
    icon: 'FileText',
    packages: withFamilies(apt('rsyslog'), { rocky: ['rsyslog'], alpine: ['rsyslog'] }),
  },
  {
    id: 'file-samba',
    name: 'Samba',
    group: 'server',
    description: 'SMB file server / domain member for office labs.',
    icon: 'FolderTree',
    packages: withFamilies(apt('samba'), { rocky: ['samba'], alpine: ['samba'] }),
  },
  {
    id: 'file-nfs',
    name: 'NFS server',
    group: 'server',
    description: 'nfs-kernel-server — export directories to clients.',
    icon: 'FolderTree',
    packages: withFamilies(apt('nfs-kernel-server'), {
      rocky: ['nfs-utils'],
      alpine: ['nfs-utils'],
    }),
  },
  {
    id: 'ldap',
    name: 'OpenLDAP',
    group: 'server',
    description: 'LDAP directory for identity and address-book labs.',
    icon: 'Users',
    packages: withFamilies(apt('slapd', 'ldap-utils'), { alpine: ['openldap'] }),
  },
  {
    id: 'kerberos',
    name: 'Kerberos KDC',
    group: 'server',
    description: 'krb5-kdc — ticket authority for domain labs.',
    icon: 'KeyRound',
    packages: withFamilies(apt('krb5-kdc', 'krb5-admin-server'), {
      rocky: ['krb5-server'],
      alpine: ['krb5'],
    }),
  },
  {
    id: 'mail-postfix',
    name: 'Mail (Postfix)',
    group: 'server',
    description: 'postfix — SMTP relay and mail server.',
    icon: 'Mail',
    packages: withFamilies(apt('postfix'), { rocky: ['postfix'], alpine: ['postfix'] }),
  },
  {
    id: 'proxy-squid',
    name: 'Squid proxy',
    group: 'server',
    description: 'squid — caching HTTP proxy and ACL lab target.',
    icon: 'Globe',
    packages: withFamilies(apt('squid'), { rocky: ['squid'], alpine: ['squid'] }),
  },

  // ---- developer & general tools ------------------------------------------
  {
    id: 'git',
    name: 'Git',
    group: 'tools',
    description: 'git — version control.',
    icon: 'GitBranch',
    packages: withFamilies(apt('git'), { rocky: ['git'], alpine: ['git'] }),
  },
  {
    id: 'editors',
    name: 'Editors (vim, nano)',
    group: 'tools',
    description: 'vim + nano — terminal text editors.',
    icon: 'FileCode',
    packages: withFamilies(apt('vim', 'nano'), {
      rocky: ['vim-enhanced', 'nano'],
      alpine: ['vim', 'nano'],
    }),
  },
  {
    id: 'http-tools',
    name: 'HTTP tools',
    group: 'tools',
    description: 'curl + wget — fetch and debug HTTP.',
    icon: 'Download',
    packages: withFamilies(apt('curl', 'wget'), {
      rocky: ['curl', 'wget'],
      alpine: ['curl', 'wget'],
    }),
  },
  {
    id: 'sysmonitor',
    name: 'System monitors',
    group: 'tools',
    description: 'htop + tmux — process view and persistent sessions.',
    icon: 'Gauge',
    packages: withFamilies(apt('htop', 'tmux'), {
      rocky: ['htop', 'tmux'],
      alpine: ['htop', 'tmux'],
    }),
  },
  {
    id: 'python',
    name: 'Python 3',
    group: 'tools',
    description: 'python3 — scripting and automation.',
    icon: 'Terminal',
    packages: withFamilies(apt('python3'), { rocky: ['python3'], alpine: ['python3'] }),
  },
  {
    id: 'toolchain',
    name: 'Build toolchain',
    group: 'tools',
    description: 'gcc, make and headers.',
    icon: 'Hammer',
    packages: withFamilies(apt('build-essential'), {
      rocky: ['gcc', 'gcc-c++', 'make'],
      alpine: ['build-base'],
    }),
  },
];
