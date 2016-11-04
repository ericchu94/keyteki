const _ = require('underscore');
const EventEmitter = require('events');

const Player = require('./player.js');
const cards = require('./cards');

class Game extends EventEmitter {
    constructor(game) {
        super();

        this.players = {};
        this.messages = [];

        _.each(game.players, player => {
            this.players[player.id] = new Player(player);
        });

        this.name = game.name;
        this.id = game.id;
    }

    addMessage(message) {
        this.messages.push({ date: new Date(), message: message });
    }

    getState(activePlayer) {
        var playerState = {};

        _.each(this.players, player => {
            playerState[player.id] = player.getState(activePlayer === player.id);
        });

        return {
            name: this.name,
            players: playerState,
            messages: this.messages
        };
    }

    startGameIfAble() {
        if(_.all(this.players, player => {
            return player.readyToStart;
        })) {
            _.each(this.players, player => {
                player.startGame();
            });
        }
    }

    mulligan(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player.mulligan();

        this.addMessage(player.name + ' has taken a mulligan');
    }

    keep(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player.keep();
        this.addMessage(player.name + ' has kept their hand');
    }

    playCard(playerId, card) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        this.emit('beforeCardPlayed', this, player, card);
        player.playCard(card);
        this.emit('afterCardPlayed', this, player, card);

        var cardImplemation = cards[card.code];
        if(cardImplemation && cardImplemation.register) {
            cardImplemation.register(this, player, card);
        }
    }

    checkForAttachments() {
        var playersWithAttachments = _.filter(this.players, p => {
            return p.hasUnmappedAttachments();
        });
        var playersWaiting = _.filter(this.players, p => {
            return !p.hasUnmappedAttachments();
        });

        if(playersWithAttachments.length !== 0) {
            _.each(playersWithAttachments, p => {
                p.menuTitle = 'Select attachment locations';
                p.buttons = [
                    { command: 'mapattachments', text: 'Done' }
                ];
                p.waitingForAttachments = true;
            });

            _.each(playersWaiting, p => {
                p.menuTitle = 'Waiting for opponent to finish setup';
                p.buttons = [];
            });
        } else {
            _.each(this.players, p => {
                p.postSetup();
                p.startPlotPhase();
            });
        }
    }

    setupDone(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player.setupDone();

        this.addMessage(player.name + ' has finished setup');

        if(!_.all(this.players, p => {
            return p.setup;
        })) {
            player.menuTitle = 'Waiting for opponent to finish setup';
            player.buttons = [];
        } else {
            this.checkForAttachments();
        }
    }

    firstPlayerPrompt(highestPlayer) {
        highestPlayer.firstPlayer = true;
        highestPlayer.menuTitle = 'Select a first player';
        highestPlayer.buttons = [
            { command: 'firstplayer', text: 'Me', arg: 'me' }
        ];

        if(_.size(this.players) > 1) {
            highestPlayer.buttons.push({ command: 'firstplayer', text: 'Opponent', arg: 'opponent' });
        }

        var otherPlayer = _.find(this.players, player => {
            return player.id !== highestPlayer.id;
        });

        if(otherPlayer) {
            otherPlayer.menuTitle = 'Waiting for opponent to select first player';
            otherPlayer.buttons = [];
        }
    }

    selectPlot(playerId, plot) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        if(!player.selectPlot(plot)) {
            return;
        }

        var plotImplementation = cards[player.selectedPlot.card.code];
        if(plotImplementation && plotImplementation.register) {
            plotImplementation.register(this, player);
        }

        this.addMessage(player.name + ' has selected a plot');

        if(!_.all(this.players, p => {
            return !!p.selectedPlot;
        })) {
            player.menuTitle = 'Waiting for opponent to select plot';
            player.buttons = [];
        } else {
            var highestPlayer = undefined;
            var highestInitiative = -1;
            _.each(this.players, p => {
                if(p.selectedPlot.card.initiative > highestInitiative) {
                    highestInitiative = p.selectedPlot.card.initiative;
                    highestPlayer = p;
                }
            });

            this.firstPlayerPrompt(highestPlayer);
        }
    }

    beginMarshal(player) {
        player.beginMarshal();

        this.emit('beginMarshal', this, player);

        var otherPlayer = _.find(this.players, p => {
            return player.id !== p.id;
        });

        if(otherPlayer) {
            otherPlayer.menuTitle = 'Waiting for opponent to marshal their cards';
            otherPlayer.buttons = [];
        }
    }

    revealDone(player) {
        var otherPlayer = _.find(this.players, p => {
            return p.id !== player.id;
        });

        if(otherPlayer && !otherPlayer.plotRevealed) {
            this.revealPlot(otherPlayer);

            return;
        }

        if(!otherPlayer) {
            this.beginMarshal(player);

            return;
        }

        var firstPlayer = player.firstPlayer ? player : otherPlayer;

        if(player.plotRevealed && otherPlayer.plotRevealed) {
            this.beginMarshal(firstPlayer);
        }
    }

    revealPlot(player) {
        player.revealPlot();

        this.pauseForPlot = false;
        this.emit('plotRevealed', this, player);

        if(!this.pauseForPlot) {
            this.revealDone(player);
        }
    }

    setFirstPlayer(sourcePlayer, who) {
        var firstPlayer = undefined;

        var player = _.find(this.players, player => {
            return player.id === sourcePlayer;
        });

        _.each(this.players, player => {
            if(player.id === sourcePlayer && who === 'me') {
                player.firstPlayer = true;
                firstPlayer = player;
            } else if(player.id !== sourcePlayer && who !== 'me') {
                player.firstPlayer = true;
                firstPlayer = player;
            } else {
                player.firstPlayer = false;
            }

            player.drawPhase();
            player.menuTitle = '';
            player.buttons = [];
        });

        this.addMessage(player.name + ' has selected ' + firstPlayer.name + ' to be the first player');

        this.revealPlot(firstPlayer);
    }

    cardClicked(sourcePlayer, card) {
        var player = _.find(this.players, player => {
            return player.id === sourcePlayer;
        });

        if(!player) {
            return;
        }

        var otherPlayer = _.find(this.players, p => {
            return p.id !== player.id;
        });

        this.clickHandled = false;
        this.emit('cardClicked', this, player, card);
        if(this.clickHandled) {
            return;
        }

        if(player.phase === 'setup' && !player.waitingForAttachments) {
            return;
        }

        if(player.selectedAttachment) {
            this.canAttach = true;
            this.emit('beforeAttach', this, player, card);
            if(!this.canAttach) {
                return;
            }

            player.removeFromHand(player.selectedAttachment);
            player.attach(player.selectedAttachment, card);

            if(player.phase === 'setup') {
                this.checkForAttachments();
            } else {
                player.buttons = [{ command: 'donemarshal', text: 'Done' }];
                player.menuTitle = 'Marshal your cards';
            }

            return;
        }

        if(player.phase === 'challenge' && player.currentChallenge) {
            var cardInPlay = _.find(player.cardsInPlay, c => {
                return c.card.code === card.code;
            });

            if(!cardInPlay) {
                if(otherPlayer) {
                    var otherCardInPlay = _.find(otherPlayer.cardsInPlay, c => {
                        return c.card.code === card.code;
                    });

                    if(!otherPlayer.addToStealth(otherCardInPlay)) {
                        return;
                    }

                    this.addMessage(player.name + ' has chosen ' + otherCardInPlay.card.label + ' as a stealth target');
                    this.addMessage(player.name + ' has initiated a ' + player.currentChallenge + ' challenge with strength ' + player.challengeStrength);

                    player.menuTitle = 'Waiting for opponent to defend';
                    player.buttons = [];
                    player.selectCard = false;

                    otherPlayer.beginDefend(player.currentChallenge);
                }

                return;
            }

            if(cardInPlay.kneeled) {
                return;
            }

            player.addToChallenge(card);
            return;
        }

        if(player.phase === 'claim' && player.currentChallenge === 'military') {
            if(card.type_code !== 'character') {
                return;
            }

            player.killCharacter(card);

            if(player.claimToDo === 0) {
                player.doneClaim();

                if(otherPlayer) {
                    otherPlayer.beginChallenge();
                }
            }

            return;
        }

        if(player.phase !== 'setup' || card.type_code !== 'attachment') {
            return;
        }

        player.selectedAttachment = card;
        player.selectCard = true;
        player.menuTitle = 'Select target for attachment';
    }

    showDrawDeck(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player.showDrawDeck();

        this.addMessage(player.name + ' is looking at their deck');
    }

    drop(playerId, card, source, target) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        if(player.drop(card, source, target)) {
            this.addMessage(player.name + ' has moved a card from their ' + source + ' to their ' + target);
        }
    }

    marshalDone(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player.marshalDone();

        this.addMessage(player.name + ' has finished marshalling');

        var unMarshalledPlayer = _.find(this.players, p => {
            return !p.marshalled;
        });

        if(unMarshalledPlayer) {
            player.menuTitle = 'Waiting for opponent to finish marshalling';
            player.buttons = [];

            unMarshalledPlayer.beginMarshal();
        } else {
            var firstPlayer = _.find(this.players, p => {
                return p.firstPlayer;
            });

            firstPlayer.beginChallenge();

            var otherPlayer = _.find(this.players, p => {
                return p.id !== firstPlayer.id;
            });

            if(otherPlayer) {
                otherPlayer.menuTitle = 'Waiting for opponent to initiate challenge';
                otherPlayer.buttons = [];
            }
        }
    }

    startChallenge(playerId, challengeType) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        if(player.challenges.complete >= player.challenges.maxTotal) {
            return;
        }

        if(player.challenges[challengeType].performed >= player.challenges[challengeType].max) {
            return;
        }

        player.startChallenge(challengeType);
    }

    doneChallenge(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        if(!_.any(player.cardsInPlay, card => {
            return card.selected;
        })) {
            player.beginChallenge();
            return;
        }

        var otherPlayer = _.find(this.players, p => {
            return p.id !== player.id;
        });

        player.doneChallenge();
        if(otherPlayer) {
            otherPlayer.currentChallenge = player.currentChallenge;
        }

        var stealthCard = _.find(player.cardsInChallenge, card => {
            return !card.stealthTarget && this.hasKeyword(card.card, 'Stealth');
        });

        if(stealthCard) {
            player.menuTitle = 'Select stealth target for ' + stealthCard.card.label;
            player.buttons = [
                { command: 'donestealth', text: 'Done' }
            ];
            player.stealthCard = stealthCard;
            player.selectCard = true;

            return;
        }

        this.addMessage(player.name + ' has initiated a ' + player.currentChallenge + ' challenge with strength ' + player.challengeStrength);

        if(otherPlayer) {
            player.menuTitle = 'Waiting for opponent to defend';
            player.buttons = [];

            otherPlayer.beginDefend(player.currentChallenge);
        }
    }

    doneDefend(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player.doneChallenge();

        this.addMessage(player.name + ' has defended with strength ' + player.challengeStrength);

        var challenger = _.find(this.players, p => {
            return p.id !== player.id;
        });

        var winner = undefined;
        var loser = undefined;

        if(challenger) {
            if(challenger.challengeStrength >= player.challengeStrength) {
                loser = player;
                winner = challenger;
            } else {
                loser = challenger;
                winner = player;
            }

            this.addMessage(winner.name + ' won a ' + winner.currentChallenge + '  challenge ' +
                winner.challengeStrength + ' vs ' + loser.challengeStrength);

            if(loser.challengeStrength === 0) {
                winner.power++;

                this.addMessage(winner.name + ' has gained 1 power from an unopposed challenge');

                if(winner.getTotalPower() > 15) {
                    this.addMessage(winner.name + ' has won the game');
                }
            }

            this.applyKeywords(winner, loser);

            if(winner === challenger) {
                this.applyClaim(winner, loser);
            } else {
                challenger.beginChallenge();

                player.menuTitle = 'Waiting for opponent to initiate challenge';
                player.buttons = [];
            }
        }
    }

    hasKeyword(card, keyword) {
        return card.text.indexOf(keyword + '.') !== -1;
    }

    applyKeywords(winner, loser) {
        _.each(winner.cardsInChallenge, card => {
            if(this.hasKeyword(card.card, 'Insight')) {
                winner.drawCardsToHand(1);

                this.addMessage(winner.name + ' draws a card from Insight on ' + card.card.label);
            }

            if(this.hasKeyword(card.card, 'Intimidate')) {
                // something
            }

            if(this.hasKeyword(card.card, 'Pillage')) {
                loser.discardFromDraw(1);

                this.addMessage(loser.name + ' discards a card from the top of their deck from Pillage on ' + card.card.label);
            }

            if(this.hasKeyword(card.card, 'Renown')) {
                card.power++;

                this.addMessage(winner.name + ' gains 1 power on ' + card.card.label + ' from Renown');
            }

            if(winner.getTotalPower() > 15) {
                this.addMessage(winner.name + ' has won the game');
            }
        });
    }

    applyClaim(winner, loser) {
        this.emit('beforeClaim', this, winner.currentChallenge, winner, loser);
        var claim = winner.activePlot.card.claim;

        if(claim <= 0) {
            this.addMessage('The claim value for ' + winner.currentChallenge + ' is 0, no claim occurs');
        } else {
            if(winner.currentChallenge === 'military') {
                winner.menuTitle = 'Waiting for opponent to apply claim effects';
                winner.buttons = [];

                loser.claimToDo = claim;
                loser.selectCharacterToKill();

                return;
            } else if(winner.currentChallenge === 'intrigue') {
                loser.discardAtRandom(claim);
            } else if(winner.currentChallenge === 'power') {
                if(loser.power > 0) {
                    loser.power -= claim;
                    winner.power += claim;

                    if(winner.getTotalPower() > 15) {
                        this.addMessage(winner.name + ' has won the game');
                    }
                }
            }
        }

        this.emit('afterClaim', this, winner.currentChallenge, winner, loser);
        loser.doneClaim();
        winner.beginChallenge();
    }

    doneChallenges(playerId) {
        var challenger = _.find(this.players, player => {
            return player.id === playerId;
        });

        challenger.doneChallenges = true;

        var other = _.find(this.players, p => {
            return !p.doneChallenges;
        });

        if(other) {
            other.beginChallenge();

            challenger.menuTitle = 'Waiting for opponent to initiate challenge';
            challenger.buttons = [];
        } else {
            this.dominance();
        }
    }

    dominance() {
        var highestDominance = 0;
        var highestPlayer = undefined;

        _.each(this.players, player => {
            player.phase = 'dominance';
            var dominance = player.getDominance();

            if(dominance > highestDominance) {
                highestPlayer = player;
            }
        });

        this.addMessage(highestPlayer.name + ' wins dominance');

        highestPlayer.power++;

        if(highestPlayer.getTotalPower() > 15) {
            this.addMessage(highestPlayer.name + ' has won the game');
        }

        this.emit('cardsStanding', this);

        _.each(this.players, player => {
            player.standCards();
            player.taxation();
        });

        var firstPlayer = _.find(this.players, p => {
            return p.firstPlayer;
        });

        firstPlayer.menuTitle = '';
        firstPlayer.buttons = [
            { command: 'doneround', text: 'End Turn' }
        ];

        var otherPlayer = _.find(this.players, p => {
            return p.id !== firstPlayer.id;
        });

        if(otherPlayer) {
            otherPlayer.menuTitle = 'Waiting for opponent to end their turn';
            otherPlayer.buttons = [];
        }
    }

    doneRound(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        if(player.hand.length > player.activePlot.card.reserve) {
            return;
        }
        var otherPlayer = _.find(this.players, p => {
            return p.id !== player.id;
        });

        if(!otherPlayer) {
            player.startPlotPhase();

            this.removeAllListeners('plotRevealed');

            return;
        }

        if(otherPlayer && otherPlayer.roundDone) {
            player.startPlotPhase();
            otherPlayer.startPlotPhase();

            this.removeAllListeners('plotRevealed');

            return;
        }

        player.roundDone = true;
        player.menuTitle = 'Waiting for opponent to end their turn';
        player.buttons = [];

        if(otherPlayer) {
            otherPlayer.menuTitle = '';
            otherPlayer.buttons = [
                { command: 'doneround', text: 'End Turn' }
            ];
        }
    }

    changeStat(playerId, stat, value) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        player[stat] += value;

        if(player[stat] < 0) {
            player[stat] = 0;
        } else {
            this.addMessage(player.name + ' sets ' + stat + ' to ' + player[stat] + ' (' + (value > 0 ? '+' : '') + value + ')');
        }
    }

    customCommand(playerId, arg) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        this.emit('customCommand', this, player, arg);
    }

    chat(playerId, message) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        this.addMessage('<' + player.name + '> ' + message);
    }

    playerDisconnect(playerId) {
        var player = _.find(this.players, player => {
            return player.id === playerId;
        });

        this.addMessage(player.name + ' has disconnected');
    }

    initialise() {
        _.each(this.players, player => {
            player.initialise();
        });
    }
}

module.exports = Game;
