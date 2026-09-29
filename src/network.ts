import { MOVEMENT } from './constants';
import ctx from './context';

const is_server = true;
const is_net = false;
const sock = null;

enum NETCMD {
    NACK = 0,
    ACK = 1,
    HELLO = 2,
    GREENLIGHT = 3,
    MOVE = 4,
    BYE = 5,
    POSITION = 6,
    ALIVE = 7,
    KILL = 8,
}

type NetPacket = {
    cmd: NETCMD;
    arg: number;
    arg2: any;
    arg3: any;
    arg4: any;
};

export function processMovePacket(pkt: NetPacket) {
    const player = ctx.player;
    const playerid = pkt.arg;
    const { movement_type, new_val } = pkt.arg2;

    if (movement_type == MOVEMENT.LEFT) {
        player[playerid].action_left = new_val;
    } else if (movement_type == MOVEMENT.RIGHT) {
        player[playerid].action_right = new_val;
    } else if (movement_type == MOVEMENT.UP) {
        player[playerid].action_up = new_val;
    } else {
        console.log('bogus MOVE packet!\n');
    }

    player[playerid].x = pkt.arg3;
    player[playerid].y = pkt.arg4;
}

export function tellServerPlayerMoved(player_id: number, movement_type: MOVEMENT, new_val: boolean) {
    const player = ctx.player;
    const pkt: NetPacket = {
        cmd: NETCMD.MOVE,
        arg: player_id,
        arg2: {
            movement_type,
            new_val,
        },
        arg3: player[player_id].x,
        arg4: player[player_id].y,
    };

    if (is_server) {
        processMovePacket(pkt);
        if (is_net) {
            sendPacketToAll(pkt);
        }
    } else {
        sendPacketToSock(sock, pkt);
    }
}

export function serverTellEveryoneGoodbye() {}

export function tellServerGoodbye() {}

export function update_players_from_clients() {}

export function update_players_from_server(): boolean {
    return true;
}

export function tellServerNewPosition() {}

function sendPacketToAll(pkt: NetPacket) {}

function sendPacketToSock(sock: any, pkt: NetPacket) {}
