BREAKOUT_ROOM_BOT_VERSION = "2020.09.7"

// HELPER FUNCTIONS

function getStoreObservable(store) {
    return new rxjs.Observable(function (observer) {
        const unsubscribe = store.subscribe(function () {
            observer.next(store.getState());
        });
    });
}

function chatboxSend(msg) {
    const chatboxElement = document.getElementsByClassName('chat-box__chat-textarea')[0];
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeTextAreaValueSetter.call(chatboxElement, msg);
    chatboxElement.dispatchEvent(new Event('input', { bubbles: true }));

    const oEvent = document.createEvent('KeyboardEvent');
    // Chromium Hack
    Object.defineProperty(oEvent, 'keyCode', {
        get: function () {
            return this.keyCodeVal;
        }
    });
    Object.defineProperty(oEvent, 'which', {
        get: function () {
            return this.keyCodeVal;
        }
    });

    const k = 13;

    oEvent.initKeyboardEvent("keydown", true, true, document.defaultView, k, k, "", "", false, "");

    oEvent.keyCodeVal = k;

    chatboxElement.dispatchEvent(oEvent);
}

function reactMouseOver(el) {
    var oEvent = document.createEvent('MouseEvent');
    oEvent.initMouseEvent("mouseover", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
    el.dispatchEvent(oEvent);
}

// This function uses websockets
function assignUserIdToBreakoutRoomUuid(senderUserId, roomUuid) {
    console.log(`Assigning ${senderUserId} to ${roomUuid}`)
    var storeState = internalStore.getState();
    var sender = storeState.attendeesList.attendeesList.find(({ userId }) => userId == senderUserId)
    var senderInBreakoutRoom = storeState.breakoutRoom.roomList.flatMap(room => room.attendeeIdList).includes(sender.userGUID)
    if (senderInBreakoutRoom) {
        window.commandSocket.send(JSON.stringify(
            { "evt": 4181, "body": { "targetBID": roomUuid, "targetID": senderUserId }, "seq": 0 }
        ))
    } else {
        window.commandSocket.send(JSON.stringify(
            { "evt": 4179, "body": { "targetBID": roomUuid, "targetID": senderUserId }, "seq": 0 }
        ))
    }
}

// https://stackoverflow.com/a/61511955/286021
function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

// OBSERVABLES

var internalStore = document.getElementById('root')._reactRootContainer._internalRoot.current.child.pendingProps.store;

var store$ = getStoreObservable(internalStore)

var chat$ = store$.pipe(
    rxjs.operators.map(s => s.chat.meetingChat),
    rxjs.operators.distinctUntilChanged(),
    rxjs.operators.skip(1),
)

// Transforms the user to map stuff to be a user -> name pair like IRC/etc
var userMessageMap$ = chat$.pipe(
    rxjs.operators.map(chatState => {
        return {
            sender: chatState.slice(-1)[0].sender,
            senderUserId: chatState.slice(-1)[0].senderId,
            message: chatState.slice(-1)[0].chatMsgs.slice(-1)[0],
        }
    }),
)

var versionCommand$ = userMessageMap$.pipe(
    rxjs.operators.filter(({ message }) => message == "!version"),
)

var versionReply$ = versionCommand$.pipe(
    rxjs.operators.map((_) => `🤖💔 BreakoutRoomBot ${BREAKOUT_ROOM_BOT_VERSION}\ngithub.com/nelsonjchen/HackyZoomBreakoutBot`)
)

var breakoutRoomListCommand$ = userMessageMap$.pipe(
    rxjs.operators.filter(({ message }) => message.text === "!ls"),
)

var breakoutRoomListReply$ = breakoutRoomListCommand$.pipe(
    rxjs.operators.withLatestFrom(
        store$,
        (_, storeState) =>
            "📜 Breakout Room List\n" +
            "Chat \"!ls\" to see this list\n" +
            "ID. Room Name (Attendee(s) in Room)\n=============\n" +
            storeState.breakoutRoom.roomList.map(
                (room, index) => `⬛ ${index + 1}. ${room.name} (${storeState.attendeesList.attendeesList.filter(attendee => attendee.bid == room.boId).length} attendee(s))`
            ).join('\n') +
            "\n" +
            "Chat \"!mv ID\" or append \"[ID]\" to your name to be assigned to the breakout room.\n" +
            "List attendees of a room by chatting \"!ls <room name here>\""
    ),
)

var breakoutRoomListUsersInRoomReply$ = userMessageMap$.pipe(
    rxjs.operators.filter(({ message }) => /!ls (.+)/.test(message)),
    rxjs.operators.withLatestFrom(
        store$,
        ({ message }, storeState) => {
            var targetRoomQuery = message.match(/!ls (.+)/)[1];

            var results = fuzzysort.go(targetRoomQuery, storeState.breakoutRoom.roomList, { key: 'name' });
            if (results.length == 0) {
                return `⚠️ No room names matched for query: ${targetRoomQuery}!\n`
            }
            var room = results[0].obj;
            var attendeesInRoom = storeState.attendeesList.attendeesList.filter(attendee => attendee.bid == room.boId)

            if (attendeesInRoom.length == 0) {
                return `📜 No attendees in ⬛ ${room.name}`
            }

            return `📜 Attendees in ⬛ ${room.name}\n` +
                attendeesInRoom.map(
                    attendee => `👤 ${attendee.displayName}`
                ).join('\n')
        }
    ),
)

var nameChange$ = store$.pipe(
    rxjs.operators.map(s => s.attendeesList.attendeesList),
    rxjs.operators.map(list => new Map(
        list.map(
            attendee => [attendee.userId, attendee.displayName]
        )
    )
    ),
    rxjs.operators.scan((acc, attendeesMap) => {
        if (acc === undefined) {
            return { previousMap: attendeesMap, changedNames: [] }
        }

        var changedNames = [];

        for (let [userId, displayName] of attendeesMap.entries()) {
            let oldDisplayName = acc.previousMap.get(userId);
            if (oldDisplayName != undefined && oldDisplayName != displayName) {
                changedNames.push({
                    oldDisplayName: oldDisplayName,
                    newDisplayName: displayName,
                    senderUserId: userId,
                });
            }
        }

        return { previousMap: attendeesMap, changedNames: changedNames }
    }, undefined),
    rxjs.operators.map((acc) => acc.changedNames),
    rxjs.operators.distinctUntilChanged(),
    rxjs.operators.filter((changedNames) => changedNames.length > 0),
    rxjs.operators.flatMap((changedNames) => rxjs.from(changedNames)),
)

var moveRequestQueryFromInitialNames$ = new rxjs.Subject();

var moveRequestQueryFromNameChange$ = nameChange$.pipe(
    // Only operate on names that change to a format requesting a room
    rxjs.operators.filter((changedNamePair) => {
        const regex = /\[(.+)\]/;
        return regex.test(changedNamePair.newDisplayName);
    }),
    // Ignore names that change but match the old name's query
    rxjs.operators.filter((changedNamePair) => {
        const regex = /\[(.+)\]/;
        var newNameTest = regex.test(changedNamePair.newDisplayName);
        var oldNameTest = regex.test(changedNamePair.oldDisplayName);
        if (newNameTest && oldNameTest) {
            var targetRoomNew = changedNamePair.newDisplayName.match(regex)[1]
            var targetRoomOld = changedNamePair.oldDisplayName.match(regex)[1]
            if (targetRoomNew == targetRoomOld) {
                return false;
            }
        }
        return true
    }),
    rxjs.operators.map((changedNamePair) => {
        const regex = /\[(.+)\]/;
        var targetRoomQuery = changedNamePair.newDisplayName.match(regex)[1]
        return {
            senderUserId: changedNamePair.senderUserId,
            sender: changedNamePair.newDisplayName,
            targetRoomQuery,
            src: 'nameChange'
        }
    }),
)

var chatMoveRequestCommand$ = userMessageMap$.pipe(
    rxjs.operators.filter(({ message }) => message.text.startsWith("!mv ")),
)

var moveRequestQueryFromChat$ = chatMoveRequestCommand$.pipe(
    rxjs.operators.map(({ sender, message, senderUserId }) => {
        const regex = /!mv (.+)/;
        var targetRoomQuery = message.text.match(regex)[1]
        return {
            sender: sender,
            senderUserId: senderUserId,
            targetRoomQuery: targetRoomQuery,
            src: 'chat'
        }
    }),
)

var moveRequestQuery$ = rxjs.merge(
    moveRequestQueryFromChat$,
    moveRequestQueryFromNameChange$,
    moveRequestQueryFromInitialNames$,
)

var [moveRequestSimpleIdQuery$, moveRequestStringQuery$] = moveRequestQuery$.pipe(
    rxjs.operators.partition(({ targetRoomQuery }) => /^\d+$/.test(targetRoomQuery))
)

var moveRequestSimpleIdQueryResolved$ = moveRequestSimpleIdQuery$.pipe(
    rxjs.operators.withLatestFrom(
        store$,
        ({ sender, targetRoomQuery, src, senderUserId }, storeState) => {
            var roomIndex = parseInt(targetRoomQuery, 10);

            if (roomIndex == 0 || roomIndex > storeState.breakoutRoom.roomList.length) {
                return { error: `⚠️ (from ${src})\n @${sender} Room ID "${targetRoomQuery}" out of range!\n` }
            }

            var room = storeState.breakoutRoom.roomList[roomIndex - 1]

            var roomName = room.name
            var roomUuid = room.boId

            return { sender, roomName, src, senderUserId, roomUuid }
        }
    ),
)

var moveRequestStringQueryResolved$ = moveRequestStringQuery$.pipe(
    rxjs.operators.withLatestFrom(
        store$,
        ({ sender, targetRoomQuery, src, senderUserId }, storeState) => {
            var results = fuzzysort.go(targetRoomQuery, storeState.breakoutRoom.roomList, { key: 'name' });
            if (results.length == 0) {
                return { error: `⚠️ (from ${src})\n @${sender} No names matched for query: ${targetRoomQuery}!\n` }
            }
            var roomName = results[0].obj.name;
            var roomUuid = results[0].obj.boId;

            return { sender, roomName, src, senderUserId, roomUuid }
        }
    ),
)

var moveRequestResolved$ = rxjs.merge(
    moveRequestSimpleIdQueryResolved$,
    moveRequestStringQueryResolved$,
)

var [moveRequestResolveError$, moveRequestResolved$] = moveRequestResolved$.pipe(
    rxjs.operators.partition(({ error }) => error),
)


var moveRequestChecked$ = moveRequestResolved$.pipe(
    rxjs.operators.withLatestFrom(
        store$,
        ({ sender, roomName, src, senderUserId, roomUuid }, storeState) => {
            var guidSenderMap = new Map(
                storeState.attendeesList.attendeesList.map(
                    attendee => [attendee.userGUID, attendee.displayName]
                )
            );

            var room = storeState.breakoutRoom.roomList.filter(room => room.name == roomName)[0]
            var roomAttendeesByName = room.attendeeIdList.map(attendeeId => guidSenderMap.get(attendeeId));

            if (roomAttendeesByName.includes(sender) && src == 'initialName') {
                // Don't return errors
                return null
            }

            if (roomAttendeesByName.includes(sender)) {
                return { error: `⚠️ (from ${src})\n "${sender}" already in "${room.name}"\n` }
            }

            return { sender, roomName, src, senderUserId, roomUuid }
        }
    ),
    rxjs.operators.filter(item =>
        item != null
    )
)

var [moveRequestInvalidError$, moveRequestValid$] = moveRequestChecked$.pipe(
    rxjs.operators.partition(({ error }) => error),
)

var moveRequestValidTimeSlice$ = rxjs.interval(10);

var moveRequestValidTimeSliceQueue$ = rxjs.zip(moveRequestValid$, moveRequestValidTimeSlice$).pipe(
    rxjs.operators.map(([s, _d]) => s)
)

var moveRequestError$ = rxjs.merge(
    moveRequestResolveError$,
    moveRequestInvalidError$,
)

var moveRequestErrorsAndSuccess$ = rxjs.merge(
    moveRequestError$,
    moveRequestValidTimeSliceQueue$
)

var moveFulfillChatResponse$ = new rxjs.Subject();

var moveFulfillChatResponseBuffered$ = moveFulfillChatResponse$.pipe(
    rxjs.operators.bufferTime(1000),
    rxjs.operators.filter(messages => messages.length != 0),
    rxjs.operators.map(messages => {
        if (messages.length == 1) {
            return messages[0]
        } else {
            return `🎯🎯🎯 Assigned ${messages.length} users over the last second.\n❓ Attendees may need to press the Breakout Rooms button to join their newly assigned breakout room.\n`
        }
    })
);

// SUBSCRIPTIONS

var versionReplySubscription = versionReply$.subscribe(
    (message) => chatboxSend(message)
)

var breakoutRoomListReplySubscription = breakoutRoomListReply$.subscribe(
    (message) => chatboxSend(message)
)

var breakoutRoomListReplySubscription = breakoutRoomListUsersInRoomReply$.subscribe(
    (message) => chatboxSend(message)
)

var moveRequestFulfillNotifySubscription = moveRequestErrorsAndSuccess$.subscribe(
    ({ sender, roomName, src, error, senderUserId, roomUuid }) => {
        if (error) {
            chatboxSend(error);
            return;
        }
        try {
            // ~ 2ms
            assignUserIdToBreakoutRoomUuid(senderUserId, roomUuid)
            moveFulfillChatResponse$.next(`🎯 (from ${src})\n Assigning\n👤 "${sender}"\nto\n⬛ "${roomName}"\n` +
                "❓ Attendee may need to press the Breakout Rooms button\n to join the newly assigned breakout meeting.\n❓ Chat \"!ls\" to list rooms and other commands.\n")
        } catch {

        }
    }
)

var moveFullfillChatResponseSubscription = moveFulfillChatResponseBuffered$.subscribe(message => {
    // ~ 30ms
    chatboxSend(message)
})

// Open the chat pane if it isn't already open.
var chatPaneButton = document.querySelector('[aria-label^="open the chat pane"]')
if (chatPaneButton) {
    chatPaneButton.click();
}

setTimeout(_ => {
    chatboxSend(`Breakout Rooms Bot for Zoom Meetings ${BREAKOUT_ROOM_BOT_VERSION} activated.\n\nAttendees, chat "!ls" in main meeting chat to list rooms and commands.\nUse a "!mv" in main meeting chat or append a [<room id>] or [room name] in to your name to choose a room.\nChat commands only work in main meeting\n however renames are detected anywhere.\nUse the End Meeting button in the Breakout Room to return to the main meeting in order to use chat commands\n\nHost(s), please rename and dedicate this client for the bot and use another session to participate in the meeting.`)
}, 100)

// Move users after bot initialization
setTimeout(_ => {
    internalStore.getState().attendeesList.attendeesList.map(
        attendee => attendee.displayName
    ).filter(displayName => /\[.+\]/.test(displayName)).map(
        name => {
            return {
                sender: name,
                targetRoomQuery: name.match(/\[(.+)\]/)[1],
                src: 'initialName'
            }
        }
    ).forEach(moveRequest => {
        moveRequestQueryFromInitialNames$.next(moveRequest);
    });
}, 110)
