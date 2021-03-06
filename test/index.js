const assert = require('assert')
const KeyringController = require('../')
const configManagerGen = require('./lib/mock-config-manager')
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN
const mockEncryptor = require('./lib/mock-encryptor')
const sinon = require('sinon')
const HD_KEYRING_NAME = 'HD Key Tree'
const BASE58_ADDRESS = 'TSwZDyupYNUgYB1DJy2wQa6kgw44B7eGnA'
const HEX_ADDRESS = '41ba2a30037af603c9ed4242bf51e037db4b7f09ba'

describe('KeyringController', () => {
  let keyringController
  const password = 'password123'
  const seedWords = 'puzzle seed penalty soldier say clay field arctic metal hen cage runway'
  const addresses = ['THVmKRQci3Jd45HPnn5R2nnbFB6YPDxQWK']
  const accounts = []
  // let originalKeystore

  beforeEach(async () => {
    this.sinon = sinon.sandbox.create()
    window.localStorage = {} // Hacking localStorage support into JSDom

    keyringController = new KeyringController({
      configManager: configManagerGen(),
      encryptor: mockEncryptor,
    })

    const newState = await keyringController.createNewVaultAndKeychain(password)
  })

  afterEach(() => {
    // Cleanup mocks
    this.sinon.restore()
  })


  describe('#submitPassword', function () {
    this.timeout(10000)

    it('should not create new keyrings when called in series', async () => {
      await keyringController.createNewVaultAndKeychain(password)
      await keyringController.persistAllKeyrings()

      assert.equal(keyringController.keyrings.length, 1, 'has one keyring')
      await keyringController.submitPassword(password + 'a')
      assert.equal(keyringController.keyrings.length, 1, 'has one keyring')
      await keyringController.submitPassword('')
      assert.equal(keyringController.keyrings.length, 1, 'has one keyring')
    })
  })


  describe('#createNewVaultAndKeychain', function () {
    this.timeout(10000)

    it('should set a vault on the configManager', async () => {
      keyringController.store.updateState({ vault: null })
      assert(!keyringController.store.getState().vault, 'no previous vault')
      await keyringController.createNewVaultAndKeychain(password)
      const vault = keyringController.store.getState().vault
      assert(vault, 'vault created')
    })

    it('should encrypt keyrings with the correct password each time they are persisted', async () => {
      keyringController.store.updateState({ vault: null })
      assert(!keyringController.store.getState().vault, 'no previous vault')
      await keyringController.createNewVaultAndKeychain(password)
      const vault = keyringController.store.getState().vault
      assert(vault, 'vault created')
      keyringController.encryptor.encrypt.args.forEach(([actualPassword]) => {
        assert.equal(actualPassword, password)
      })
    })
  })

  describe('#addNewKeyring', () => {
    it('Simple Key Pair', async () => {
      const privateKey = 'c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3'
      const previousAccounts = await keyringController.getAccounts()
      const keyring = await keyringController.addNewKeyring('Simple Key Pair', [ privateKey ])
      const keyringAccounts = await keyring.getAccounts()
      const expectedKeyringAccounts = ['TJwm1qUHMpo8vggqMyXJV3xhzDdfwA5A4L']
      assert.deepEqual(keyringAccounts, expectedKeyringAccounts, 'keyringAccounts match expectation')
      const allAccounts = await keyringController.getAccounts()
      const expectedAllAccounts = previousAccounts.concat(expectedKeyringAccounts)
      assert.deepEqual(allAccounts, expectedAllAccounts, 'allAccounts match expectation')
    })
  })

  describe('#restoreKeyring', () => {
    it(`should pass a keyring's serialized data back to the correct type.`, async () => {
      const mockSerialized = {
        type: HD_KEYRING_NAME,
        data: {
          mnemonic: seedWords,
          numberOfAccounts: 1,
        },
      }

      const keyring = await keyringController.restoreKeyring(mockSerialized)
      assert.equal(keyring.wallets.length, 1, 'one wallet restored')
      const accounts = await keyring.getAccounts()
      assert.equal(accounts[0], addresses[0])
    })
  })

  describe('#getAccounts', () => {
    it('returns the result of getAccounts for each keyring', async () => {
      keyringController.keyrings = [
        { async getAccounts () { return [1, 2, 3] } },
        { async getAccounts () { return [4, 5, 6] } },
      ]

      const result = await keyringController.getAccounts()
      assert.deepEqual(result, [1, 2, 3, 4, 5, 6])
    })
  })

  describe('#removeAccount', () => {
    it('removes an account from the corresponding keyring', async () => {
      const account = {
        privateKey: 'c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3',
        publicKey: 'TJwm1qUHMpo8vggqMyXJV3xhzDdfwA5A4L',
      }

      const accountsBeforeAdding = await keyringController.getAccounts()
      // Add a new keyring with one account
      await keyringController.addNewKeyring('Simple Key Pair', [ account.privateKey ])

      // remove that account that we just added
      await keyringController.removeAccount(account.publicKey)

      // fetch accounts after removal
      const result = await keyringController.getAccounts()
      assert.deepEqual(result, accountsBeforeAdding)
    })

    it('removes the keyring if there are no accounts after removal', async () => {
      const account = {
        privateKey: 'c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3',
        publicKey: 'TJwm1qUHMpo8vggqMyXJV3xhzDdfwA5A4L',
      }

      const accountsBeforeAdding = await keyringController.getAccounts()
      // Add a new keyring with one account
      await keyringController.addNewKeyring('Simple Key Pair', [ account.privateKey ])
      // We should have 2 keyrings
      assert.equal(keyringController.keyrings.length, 2)
      // remove that account that we just added
      await keyringController.removeAccount(account.publicKey)

      // Check that the previous keyring with only one account
      // was also removed after removing the account
      assert.equal(keyringController.keyrings.length, 1)
    })

  })

  describe('#addGasBuffer', () => {
    it('adds 100k gas buffer to estimates', () => {
      const gas = '0x04ee59' // Actual estimated gas example
      const tooBigOutput = '0x80674f9' // Actual bad output
      const bnGas = new BN(ethUtil.stripHexPrefix(gas), 16)
      const correctBuffer = new BN('100000', 10)
      const correct = bnGas.add(correctBuffer)

      // const tooBig = new BN(tooBigOutput, 16)
      const result = keyringController.addGasBuffer(gas)
      const bnResult = new BN(ethUtil.stripHexPrefix(result), 16)

      assert.equal(result.indexOf('0x'), 0, 'included hex prefix')
      assert(bnResult.gt(bnGas), 'Estimate increased in value.')
      assert.equal(bnResult.sub(bnGas).toString(10), '100000', 'added 100k gas')
      assert.equal(result, '0x' + correct.toString(16), 'Added the right amount')
      assert.notEqual(result, tooBigOutput, 'not that bad estimate')
    })
  })

  describe('#unlockKeyrings', () => {
    it('returns the list of keyrings', async () => {
      keyringController.setLocked()
      const keyrings = await keyringController.unlockKeyrings(password)
      assert.notStrictEqual(keyrings.length, 0)
      keyrings.forEach(keyring => {
        assert.strictEqual(keyring.wallets.length, 1)
      })
    })
  })

  describe('#exportAccount', () => {
    it('returns the private key of the account', async () => {
      keyringController.clearKeyrings()
      // Add HD Keyring
      await keyringController.addNewKeyring('HD Key Tree', {
        mnemonic: seedWords,
        numberOfAccounts: 1,
      })
      // Add simple pair keyring
      const privateKey = 'c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3'
      await keyringController.addNewKeyring('Simple Key Pair', [ privateKey ])
      // Export simple pair private key
      const exported = await keyringController.exportAccount('TJwm1qUHMpo8vggqMyXJV3xhzDdfwA5A4L')
      assert.strictEqual(exported, privateKey, 'exported private key match expectation')
      // Export HD private key
      const exportedHD = await keyringController.exportAccount('THVmKRQci3Jd45HPnn5R2nnbFB6YPDxQWK')
      const expectedHDPrivateKey = '0d40c8cdb822d7689b31435db237be501a06c934916efce51c7ecf11ad0f24c5'
      assert.strictEqual(exportedHD, expectedHDPrivateKey, 'exported private key match expectation for HD wallet')
    })
  })
})
