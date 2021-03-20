const Card = require('../../Card.js');

class TheMurmur extends Card {
    //Action: Exhaust a friendly Unfathomable creature. If you do exhaust up to 3 creatures or artifacts.
    //This card has been translated from Chinese and is subject to change.
    setupCardAbilities(ability) {
        this.action({
            target: {
                cardType: 'creature',
                controller: 'self',
                cardCondition: (card) => card.hasHouse('unfathomable'),
                gameAction: ability.actions.exhaust()
            },
            then: {
                target: {
                    mode: 'upTo',
                    numCards: 3,
                    cardCondition: (card) => card.type === 'creature' || card.type === 'artifact',
                    gameAction: ability.actions.exhaust()
                }
            }
        });
    }
}

TheMurmur.id = 'the-murmur';

module.exports = TheMurmur;
