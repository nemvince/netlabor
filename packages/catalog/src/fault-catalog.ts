/** Cisco IOS fault catalog shared by the seeded IOU and Dynamips templates. */

import type { TemplateFault } from '@netlabor/contract';

const IOS_PROMPT = '[\\w.-]+[#>]\\s*$';

/** Reversible device faults expressed as console command sequences. */
export const iosFaults: TemplateFault[] = [
  {
    id: 'interface_shutdown',
    label: 'Shut an interface',
    params: ['interface'],
    commands: ['configure terminal', 'interface {{interface}}', 'shutdown', 'end'],
    recovery: ['configure terminal', 'interface {{interface}}', 'no shutdown', 'end'],
    prompt: IOS_PROMPT,
    requires: ['ios'],
  },
  {
    id: 'interface_mtu',
    label: 'Change an interface MTU',
    params: ['interface', 'mtu'],
    commands: ['configure terminal', 'interface {{interface}}', 'mtu {{mtu}}', 'end'],
    recovery: ['configure terminal', 'interface {{interface}}', 'no mtu', 'end'],
    prompt: IOS_PROMPT,
    requires: ['ios'],
  },
  {
    id: 'ospf_cost',
    label: 'Raise the OSPF interface cost',
    params: ['interface', 'cost'],
    commands: ['configure terminal', 'interface {{interface}}', 'ip ospf cost {{cost}}', 'end'],
    recovery: ['configure terminal', 'interface {{interface}}', 'no ip ospf cost', 'end'],
    prompt: IOS_PROMPT,
    requires: ['ios'],
  },
  {
    id: 'bgp_neighbor_shutdown',
    label: 'Shut down a BGP neighbor',
    params: ['asn', 'neighbor'],
    commands: ['configure terminal', 'router bgp {{asn}}', 'neighbor {{neighbor}} shutdown', 'end'],
    recovery: [
      'configure terminal',
      'router bgp {{asn}}',
      'no neighbor {{neighbor}} shutdown',
      'end',
    ],
    prompt: IOS_PROMPT,
    requires: ['ios'],
  },
  {
    id: 'static_blackhole',
    label: 'Install a blackhole route',
    params: ['prefix'],
    commands: ['configure terminal', 'ip route {{prefix}} Null0', 'end'],
    recovery: ['configure terminal', 'no ip route {{prefix}} Null0', 'end'],
    prompt: IOS_PROMPT,
    requires: ['ios'],
  },
  {
    id: 'acl_block',
    label: 'Block traffic with an extended ACL',
    params: ['acl', 'interface'],
    commands: [
      'configure terminal',
      'ip access-list extended {{acl}}',
      'deny ip any any',
      'exit',
      'interface {{interface}}',
      'ip access-group {{acl}} in',
      'end',
    ],
    recovery: [
      'configure terminal',
      'interface {{interface}}',
      'no ip access-group {{acl}} in',
      'exit',
      'no ip access-list extended {{acl}}',
      'end',
    ],
    prompt: IOS_PROMPT,
    requires: ['ios'],
  },
];
