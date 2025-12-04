// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateFeedFHE is SepoliaConfig {
    struct EncryptedPost {
        uint256 id;
        euint32 encryptedContent;
        euint32 encryptedMetadata;
        address author;
        uint256 timestamp;
    }
    
    struct UserPreferences {
        euint32 encryptedTopics;
        euint32 encryptedFilters;
    }
    
    struct FeedItem {
        uint256 postId;
        euint32 encryptedScore;
    }
    
    uint256 public postCount;
    mapping(uint256 => EncryptedPost) public encryptedPosts;
    mapping(address => UserPreferences) public userPreferences;
    mapping(address => FeedItem[]) private userFeed;
    
    mapping(uint256 => uint256) private requestToPostId;
    
    event PostCreated(uint256 indexed id, address indexed author);
    event FeedRequested(address indexed user);
    event FeedGenerated(address indexed user);
    
    modifier onlyAuthor(uint256 postId) {
        require(msg.sender == encryptedPosts[postId].author, "Not author");
        _;
    }
    
    function createEncryptedPost(
        euint32 encryptedContent,
        euint32 encryptedMetadata
    ) public {
        postCount += 1;
        uint256 newId = postCount;
        
        encryptedPosts[newId] = EncryptedPost({
            id: newId,
            encryptedContent: encryptedContent,
            encryptedMetadata: encryptedMetadata,
            author: msg.sender,
            timestamp: block.timestamp
        });
        
        emit PostCreated(newId, msg.sender);
    }
    
    function setUserPreferences(
        euint32 encryptedTopics,
        euint32 encryptedFilters
    ) public {
        userPreferences[msg.sender] = UserPreferences({
            encryptedTopics: encryptedTopics,
            encryptedFilters: encryptedFilters
        });
    }
    
    function requestPersonalizedFeed() public {
        require(userPreferences[msg.sender].encryptedTopics != FHE.asEuint32(0), "Preferences not set");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(userPreferences[msg.sender].encryptedTopics);
        ciphertexts[1] = FHE.toBytes32(userPreferences[msg.sender].encryptedFilters);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.generateFeed.selector);
        requestToPostId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(msg.sender)));
        
        emit FeedRequested(msg.sender);
    }
    
    function generateFeed(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        address user = address(uint160(requestToPostId[requestId]));
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory prefs = abi.decode(cleartexts, (uint32[]));
        uint32 topics = prefs[0];
        uint32 filters = prefs[1];
        
        delete userFeed[user];
        
        for (uint256 i = 1; i <= postCount; i++) {
            if (shouldIncludePost(i, topics, filters)) {
                euint32 score = calculateRelevanceScore(
                    encryptedPosts[i].encryptedMetadata,
                    userPreferences[user].encryptedTopics
                );
                
                userFeed[user].push(FeedItem({
                    postId: i,
                    encryptedScore: score
                }));
            }
        }
        
        emit FeedGenerated(user);
    }
    
    function getFeedItem(uint256 index) public view returns (uint256 postId, euint32 score) {
        require(index < userFeed[msg.sender].length, "Invalid index");
        FeedItem storage item = userFeed[msg.sender][index];
        return (item.postId, item.encryptedScore);
    }
    
    function requestFeedDecryption() public {
        require(userFeed[msg.sender].length > 0, "Feed empty");
        
        bytes32[] memory ciphertexts = new bytes32[](userFeed[msg.sender].length);
        for (uint256 i = 0; i < userFeed[msg.sender].length; i++) {
            ciphertexts[i] = FHE.toBytes32(userFeed[msg.sender][i].encryptedScore);
        }
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptFeedScores.selector);
        requestToPostId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(msg.sender)));
    }
    
    function decryptFeedScores(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        address user = address(uint160(requestToPostId[requestId]));
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory scores = abi.decode(cleartexts, (uint32[]));
    }
    
    function shouldIncludePost(uint256 postId, uint32 topics, uint32 filters) private pure returns (bool) {
        return postId % 2 == topics % 2;
    }
    
    function calculateRelevanceScore(euint32 postMetadata, euint32 userTopics) private pure returns (euint32) {
        return FHE.mul(postMetadata, userTopics);
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
}